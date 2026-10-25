---
wp: 18
title: Status (the report, `gmt status`, the Status view and the consent email)
owner: sonnet
depends_on: [16a, 16b]
spec_sections: ["§8.3 Consent expiry", "§9 item 9", "§10 GET /status", "§10 POST /alerts/test-email", "§11 Status", "§11 status bar", "§16", "§17 revision 36"]
reviewers: [product-owner, ui-reviewer, security-reviewer, test-strategy-reviewer, code-architect, provenance-auditor, persona-flexible-traveller]
mutate: {}
pending: {"@gmt/core": ["src/api-contract/system.ts"]}
status: draft
---

# WP18: Status (the report, `gmt status`, the Status view and the consent email)

Written 2026-10-19 against spec revision 36 and plan decisions 1–83, after WP16a and WP16b, and revised after review
rounds 1–3 (every finding answered in the review directories' `resolutions.md`). It builds the operator's chosen
item 4: one report of what is working, how much of each search the last finished run covered, and what to do about
what is not, served by the app, printed by `gmt status` and shown in a Status view; and the consent-expiry email
(decision 74). It runs in parallel with WP17 from the same `core` pieces WP16a already shaped (decision 76's
compatibility rule: a worker status field enters the schema one package before any worker emits it). WP18 never edits
`apps/cli/src/commands/status.ts` beyond calling WP16b's local-facts helper; WP16b is that file's only editor after
setup, and WP17 does not touch it (ARCH-R3-003).

## 1. Goal

`GET /api/status` returns every check of §6 with a state, a plain summary from a fixed template and a fix (a `pnpm gmt`
command in native mode), never spending, waiting on a vendor or loading a page, and never holding a secret or any text
it did not write itself; `gmt status` and a web Status view show the same report; the status bar links to it without
nagging about routine states; and the app emails the operator once a day while the consent check is not `ok`.

## 2. Scope

**In**: `statusResponseSchema` in `core/api-contract/system.ts`; the check builders in `apps/api/src/read/status.ts`;
the route, with `HOME` passed from the api bootstrap; `POST /api/alerts/test-email` with its in-process last result,
and offering it at the end of `gmt setup` (WP16b's wizard leaves that offer to this package, since the route is this
package's); the
consent-expiry system notice on the maintenance tick (decision 74 / §8.3); the API-backed `gmt status` on top of
WP16b's local facts; the web Status view, the nav entry and the status bar; redaction and route tests; docs
(`setup.md` §11 "Operating it"); Stryker `mutate` entries for the pure status helpers this package adds in `core`.

**Out**: editing settings in the UI; any check that spends, calls a vendor or loads a page; detecting a compose
container (a `gmt status` local fact, WP16b); filling the worker's optional status fields (WP17 emits them; this
package only reads them when present); editing `apps/cli/src/commands/status.ts` for worker-refusal display (WP16b
owns that file; this package's Task 18.5 only wires the HTTP report beside those facts).

## 3. Spec sections and plan decisions

§8.3 consent expiry; §10 `GET /status` and `POST /alerts/test-email`; §11 Status and the status bar; §9 item 9;
decisions 74 (the email), 76 (the report), 79 (catch-up notes on `data` and `schedule`).

## 4. Interfaces consumed

- `healthDetail(ctx)` (`apps/api/src/routes/system.ts`); the provider usage builder behind `GET /providers` (its wording
  reused); the budget builder; the scheduler jobs; the execution repository (each definition's **latest finished**
  parent execution — `completed`, `cancelled`, `interrupted`, or `paused_*` — its six-bucket discovery coverage per
  cell after the §6.6 roll-up, `is_catch_up` and `scheduled_for` from WP16a); an active parent run when one exists.
- Observations' effective age (`providerObservedAt` or `fetchedAt + maxAgeHours`, spec §3) and `core`'s short age
  labels, including the case `maxAgeHours` is unknown ("age unknown"); `STALE_AFTER_HOURS` and
  `CALENDAR_STALE_AFTER_HOURS`; the six bucket names from `core/coverage/buckets.ts` (priced, empty / "no fares",
  no_data / "no cached data", error, skipped, not_run / "not searched").
- `db`'s `backupsDirFor` and `<data>/backups/daily` (WP16b takes the first backup at setup, so the "first daily backup
  due" note appears only when that directory is empty).
- WP16a: `readWorkerStatus`, `sharedSettingDiffs`, `effectiveSharedSettings`, `startRefusalSchema`,
  `START_REFUSAL_REASONS`, `START_REFUSAL_TEXT`, `workerDataDir`, `workerStatusSchema` (including optional
  `sharedSettings`, `consent`, `monthly`, `appInstances`, `osArch`, `build`).
- WP16b: `readStartRefusal` / `refusalLine` for `gmt status`'s local facts.
- `notifications.claimNoticeKey` (`operator_notice_keys`) and the notifiers; `sendSystemNotice` (engine helper for the
  `{ kind: 'system', subject, body }` variant — **not** `OperatorMessageKind`, so no migration).
- `syntheticAllowed(config)` (core).
- WP16b's local `status`, `Runner`, `parseEnv` reader of `app.env`.

## 5. Interfaces produced

```ts
// packages/core/src/api-contract/system.ts
export const statusStateSchema = z.enum(['ok', 'warn', 'fail', 'off']);
export const statusAreaSchema = z.enum(['app', 'database', 'backups', 'schedule', 'data', 'provider', 'worker', 'consent', 'email']);
export const statusCheckSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  area: statusAreaSchema,
  providerId: providerIdSchema.nullable(),
  state: statusStateSchema,
  summary: z.string().max(240),
  note: z.string().max(200).nullable(),    // e.g. "first daily backup due 03:30" on an ok check
  offReason: z.enum(['not-set-up', 'not-visible', 'awaiting-verification']).nullable(), // only when state is 'off'
  fix: z.strictObject({ text: z.string().max(200), command: z.string().startsWith('pnpm gmt ').nullable() }).nullable(),
});
export const statusResponseSchema = z.strictObject({
  generatedAt: isoDateTimeSchema,
  mode: z.enum(['native', 'container', 'dev']),
  version: z.string(),
  checks: z.array(statusCheckSchema),
});
export const STATE_ORDER = { fail: 0, warn: 1, ok: 2, off: 3 } as const;
export function sortChecks(checks: readonly StatusCheck[]): StatusCheck[]; // state, then area, then id
export function barSummary(checks: readonly StatusCheck[]): { kind: 'clean' | 'warn' | 'fail'; text: string }; // shared by the bar and gmt status

// Consent expiry uses sendSystemNotice ({ kind: 'system', … }), not OperatorMessageKind.
// operator_notifications and its kind CHECK are untouched; no migration (spec §8.3; ARCH-R3-005).
```

`mode`: `IN_CONTAINER` set gives `container`, `NODE_ENV=development` gives `dev`, otherwise `native`. `version` is the
build's git short SHA, written at build time into `apps/api/dist/version.json` (missing gives `unknown`). In `container`
and `dev` mode every `fix.command` is null and the text names the compose action or the docs section.

## 6. The checks

Summaries are fixed templates filled from typed fields and enums, never from vendor, worker, ledger, file or SMTP text.
Times use `formatInstant` in the scheduler's zone. "30 days" is elapsed time, 30 × 86,400,000 ms. No template uses
"fresh", "complete", "all" or any banned word.

| id | area | ok | warn | fail | off |
|---|---|---|---|---|---|
| `app` | app | version, uptime, mode, bound to loopback with auth on | bound beyond loopback ("plain HTTP beyond this machine needs TLS or Tailscale: docs/setup.md section 3") | auth off outside dev | — |
| `database` | database | answers `select 1`; size | pending migrations | does not answer | — |
| `backups` | backups | newest in `backups/daily` ≤ 36 h old; or none while the app is younger than 36 h **and** setup has not yet written its first backup, with the note "first daily backup due <time>; pnpm gmt backup takes one now" (install-e2e after setup sees `ok` without that note, because setup's first backup is present — po-r3-003) | newest older than 36 h; fix `pnpm gmt backup` | none while the app is older than 36 h | container mode: `not-visible`, its own card, "not visible from the container: check your host's backup job (docs/setup.md section 6)" |
| `schedule` | schedule | jobs registered; last and next run; a catch-up in the last 7 days as a note ("caught up the run missed at …, ran …"); a `skipped_missed` for camoufox-only coverage as a note giving its stored `skip_code` text (`SKIP_CODE_TEXT`), never "caught up" and never re-derived from today's settings | two definitions using `camoufox` share a firing time: "<a> and <b> both fire at <time>; stagger them so neither waits for the other's browser pages" (`gmt status` prints the same) | `degraded` (job count wrong or a run stuck past `STUCK_AFTER_HOURS`); blocked since a date | no scheduled definitions (`not-set-up`) |
| `data-<definition>` | data | see **Data check** below | see **Data check** below | — | no definitions (`not-set-up`) |
| `price-sources` | provider | at least one **usable** non-synthetic discovery provider is configured (Travelpayouts, SearchApi, or the browser provider when enabled with flags for this os-arch) | none usable: "No price source is set up, so searches find nothing"; fix `pnpm gmt setup --reconfigure travelpayouts` naming Travelpayouts as the no-cost source. Fixture-only or a browser provider that is off / awaiting verification does **not** count as usable (PA3-004) | — | — |
| `provider-<id>` | provider | the most recent completed call succeeded: "last successful call <time>"; or "configured; not used yet"; usage under 80% of its cap | usage ≥ 80% of its cap; trial ≤ 10 credits left | the most recent completed call failed with `auth` or `quota` | not configured (`not-set-up`) |
| `provider-fixture` | provider | — | `syntheticAllowed(config)` true: "synthetic test data, not fares" | — | otherwise absent |
| `worker` | worker | reachable, no cool-down, flags set for its build, `sharedSettingDiffs` empty on effective values, keys equal; this month's pages and scrolls "n of cap" when `monthly` is present; the app's `CAMOUFOX_BROWSER_WINDOW` ("browser pages: only inside a run's window" for `scheduled` and unset, "browser pages: also when a run resumes" for `any`), shown on every state of the card while the provider is enabled | cooling down until a time; two app instances called it this month (`appInstances`); monthly pages or scrolls ≥ 80% of the cap | unreachable with no refusal file (fix `pnpm gmt start`); a refusal with reason `consent-*`, `layout`, `signed-in` or `locked` ("refused, not retrying: <START_REFUSAL_TEXT summary>", fix per reason); a shared setting differs (named, no value); "keys differ" (fix `pnpm gmt setup --reconfigure browser`); container mode: "not reachable from the container" | browser provider not enabled (`not-set-up`); flags unset for this build, or a refusal with reason `flags-unset` or `build-mismatch` (`awaiting-verification`, never `fail`) |
| `consent` | consent | capture (`socs`) or **not-shown** record valid more than 30 days; the summary says which: "consent rejected, expires <date> (cookie)" / "consent rejected, expires <date> (capture)" / "no consent screen in this region, recorded <date>" — never labels not-shown as a rejection (PA3-005) | ≤ 30 days left; or the worker is down with no refusal file ("cannot check") | expired or missing; kind `voided` ("consent screen now shown: capture again"); a refusal with reason `consent-missing`, `consent-expired` or `consent-voided`; fix `pnpm gmt consent` | browser provider not enabled |
| `email` | email | configured; the last test send since the app started succeeded, or none yet ("since the app started") | — | the last send since the app started failed (class only) | not configured (`not-set-up`; fix `pnpm gmt setup --reconfigure email`) |

### Data check (`data-<definition>`)

Uses the definition's **latest finished** parent run only (`completed`, `cancelled`, `interrupted`, `paused_*`). An
active run is summarised separately as "running since <time>" plus the previous finished run's counts when one exists.
A latest row that is `skipped_missed` or `skipped_budget` (or any `skipped_*` with no cells) is always `warn`: "last
firing skipped (<reason>) on <date>", the reason from the row's stored `skip_code` (or its existing `skipped_*` status text) — it never meets the cadence rule and never reads `ok` at "0 of 0" (PA3-002).

Coverage is the **six buckets** of spec §3 / `core/coverage/buckets.ts`, discovery stage, per cell after the §6.6
roll-up: "last run <date>: priced N, no fares E, no cached data D, error R, skipped S, not searched U of T cells",
followed, as spec §3 requires of every coverage display, by "(n reused from earlier runs)" when n > 0 cells' outcomes
were reused (a catch-up's browser cells are often all reused), so the line never states search activity the run did
not do.
`T` is cells after roll-up; the parts sum to `T` (property test). "Not searched" means `not_run` alone — never a
redefinition that folds skipped/error into it. Warn when `R + S + U` is over 20% of `T`.

Priced, non-synthetic observations behind that finished run supply both ends of effective age from `core`'s short
face form: "newest price <age> old, oldest <age> old". Never "prices up to <age> old" with the newest age
(po-r3-001 / PA3-001). When any priced observation's `maxAgeHours` is unknown, that end prints "age unknown". Warn
when the **oldest** known effective age of those priced cells is past its basis's stale threshold
(`STALE_AFTER_HOURS` / `CALENDAR_STALE_AFTER_HOURS`). "No prices yet" and the cadence rule are keyed on the
**definition** (its own schedule cadence), not per provider.

A catch-up's `scheduled_only` camoufox cells, and those a run left because it was past its browser window (decision
83), count in `skipped S`, each with its detail's text ("left for the next scheduled run: a catch-up loads no browser
pages" or "left for the next scheduled run: outside this run's browser window"). When the browser provider is the only
discovery provider that can schedule the definition and the latest finished run is a catch-up (or a `skipped_missed`
with `skip_code` `browser-only-definition`), the check is `warn` with the fix "a catch-up loads no browser pages: keep
the machine awake at the scheduled time, or move the schedule" — not a silent `ok` (po-r3-002). Synthetic observations never count.

## 7. Files

Create: `apps/api/src/read/status.ts` (+ `test/read/status.test.ts`, `test/routes/status.route.test.ts`),
`apps/web/src/views/Status.tsx` (+ test), `apps/web/src/components/StatusCard.tsx`, `apps/web/src/api/statusQuery.ts`.
Modify: `packages/core/src/api-contract/system.ts` (and its Stryker `mutate` glob for `sortChecks` / `barSummary`),
`apps/api/src/bootstrap/app.ts` (`HOME` into the status sources), `apps/api/src/routes/{system,alerts}.ts`, the email
notifier's last-result hook, `packages/engine/src/{maintenance,notifiers/operatorTemplates}.ts` (`sendSystemNotice`
path only), `apps/web/src/components/{Nav,StatusBar}.tsx`, `apps/web/src/api/{endpoints,queries}.ts`,
`apps/cli/src/commands/status.ts` **only** to print the HTTP report beside WP16b's `localChecks(deps)` (no new refusal
rendering here), `apps/cli/src/commands/setup.ts` **only** for the test-email offer after the closing screen,
the `apps/api` build script (`version.json`), `docs/setup.md`.

## 8. Tasks

### Task 18.1: The contract and the redaction test (first failing test)

- [ ] **Failing tests:**
  - **First failing test (§16):** with config holding sentinels for `APP_BASIC_AUTH_PASS`, `CAMOUFOX_WORKER_KEY`,
    `SEARCHAPI_KEY`, `TRAVELPAYOUTS_TOKEN`, `SMTP_PASS` and `DATABASE_PATH`, a worker stub whose status carries a
    `SOCS`-like sentinel in an unknown field, a ledger error row whose message holds a sentinel key and URL, an SMTP
    failure whose text holds a sentinel, and a `start-refusal.json` holding a hostile `fix` string and an unknown reason,
    the serialised response of every builder contains none of them (raw or base64url), and no text or command from the
    refusal file.
  - `sortChecks` orders fail, warn, ok, off, then area, then id; the schema rejects an unknown field, an `offReason` on a
    non-`off` check, and a command not starting `pnpm gmt `.
  - In `container` and `dev` mode no check carries a command.
  - Every summary and note template passes the banned-word test and contains none of "fresh", "complete", "all".
- [ ] **Implement; commit `wp18: status contract and redaction`.**

### Task 18.2: The check builders

- [ ] **Failing tests**, table-driven, one case per row and state of §6 (the test counts the cases against the table),
  with injected sources:
  - Agreement: for each case, the card's state, `barSummary`'s text and `gmt status`'s exit code agree (a `degraded`
    app is `fail` on `schedule`, bar "Status: schedule failing", exit 1); a fresh install's backups (first backup
    present) and a recent catch-up are `ok` with a note only when applicable and leave the bar clean.
  - Boundaries: backups at 36 h − 1 ms (`ok`), 36 h (`warn`), app age exactly 36 h with none (`fail`); consent at 30 × 86,400,000
    ms − 1 ms (`warn`) and exactly that (`ok`), on both sides of the 2027-03-28 and 2027-10-31 Europe/London changes.
  - Data: six-bucket labels match `core/coverage/buckets.ts`; parts sum to `T` (property); a run with
    `R + S + U` = 412 of 1,000 → `warn`; one price at 1 h beside prices at 6 d → summary names both ends and `warn` on
    the oldest past `CALENDAR_STALE_AFTER_HOURS`; an unknown `maxAgeHours` prints "age unknown"; a `skipped_missed`
    latest row → `warn`, never `ok` at 0 of 0; an active run shows "running since …" plus the previous finished counts;
    a catch-up with `scheduled_only` cells counts them under skipped with the `catch-up-no-browser` text, and a manual
    run past its window with the `outside-browser-window` text; a catch-up whose camoufox cells were all reused shows
    "(n reused from earlier runs)" with n equal to those cells, and the parts still sum to `T`; a run with nothing
    reused shows no suffix; a camoufox-only definition after a catch-up or a `browser-only-definition` `skipped_missed`
    → `warn` with that fix (po-r3-002); a `skipped_missed` row's reason comes from its `skip_code` even after SearchApi
    is configured later; unscheduled definitions show age
    without a cadence rule; synthetic observations excluded.
  - `price-sources`: none usable → `warn` with the Travelpayouts fix; fixture-only or awaiting-verification browser →
    still `warn`; one usable configured → `ok`.
  - Consent: kind `not-shown` summary is not a rejection; kind `socs` names cookie or capture bound.
  - Provider: auth error then success → `ok` with the success's time; never called → "configured; not used yet"; a
    quota error just before the window began, newest completed call failed → `fail`.
  - Worker: the card states the browser window, pinned for `CAMOUFOX_BROWSER_WINDOW` unset and `scheduled` ("browser
    pages: only inside a run's window") and `any` ("browser pages: also when a run resumes"), on `ok`, `warn` and
    `fail`; it is never compared with the worker's settings.
  - Schedule: two definitions using `camoufox` whose schedules give the same next firing → `warn` naming both and the
    time; different times, or one not using `camoufox`, → no warning.
  - Worker: `readWorkerStatus` stubbed for each `kind`; a status without WP17's optional fields builds `worker` from
    what is present and `consent` from the fallback rule; with them, from `consent.kind`, `expiresAt` and `boundedBy`;
    flags unset → `off`, `awaiting-verification`; each `START_REFUSAL_REASONS` value maps through `START_REFUSAL_TEXT`
    (`flags-unset` and `build-mismatch` to `off`; `consent-*` to `fail` on both `worker` and `consent`); a refusal older
    than the newest consent record is shown superseded; named fields only (a spread-in unknown field never appears);
    `sharedSettingDiffs` compares effective values from `sharedSettings` when present.
- [ ] **Implement; commit.**

### Task 18.3: The routes and the test email

- [ ] **Failing tests:**
  - `GET /api/status` returns 401 without auth when auth is configured, applies the Host allowlist, and validates
    against the schema.
  - A route test over a migrated in-memory database with global `fetch` stubbed to throw for anything but the worker's
    loopback URL (through http-kit): the ledger row count is unchanged before and after; a worker stub answering in 3 s
    gives `unreachable` at 2 s under fake timers.
  - `POST /api/alerts/test-email` requires the mutating-route headers; 409 when email is not configured; sends one fixed
    message; 429 past `ALERT_EMAIL_MAX_PER_HOUR`; records time and class (`sent`, `refused`, `failed`) in the process,
    never the server's text.
  - `gmt setup` with email configured, on an interactive terminal, offers once after the closing screen "Send a test
    email now?" (default no); yes posts `POST /api/alerts/test-email` with `app.env`'s basic auth and the mutating-route
    headers and prints `sent`, `refused` or `failed` with the next step; `--non-interactive`, no email, or no terminal
    never offers it; the reply's server text is never printed.
- [ ] **Implement; commit.**

### Task 18.4: The consent email on the maintenance tick

- [ ] **Failing tests:** the maintenance tick builds the consent check; while it is `warn` or `fail` and the browser
  provider is enabled, it claims `consent-expiring:<London date>` through `claimNoticeKey` and, only when the claim
  succeeds, calls `sendSystemNotice` with `{ kind: 'system', subject, body }` and sends it to every notifier; a second
  tick the same London day sends nothing; the next day sends again; `ok`, provider off, or no notifier sends nothing;
  **no** row is written to `operator_notifications`, **no** `OperatorMessageKind` member is added, and **no** migration
  is added; the message holds no `SOCS` value.
- [ ] **Implement; commit.**

### Task 18.5: `gmt status`

- [ ] **Failing tests:** with a stub app it calls `GET /api/status` with basic auth read from `app.env` by `parseEnv`
  (never argv), prints one row per check (state as text, area, summary, note, fix command) and WP16b's local facts
  (compose container, detached checkout, the worker's refusal through `refusalLine` / `START_REFUSAL_TEXT`), and the
  `barSummary` line; exits 1 on any `fail`, 0 otherwise; `--only <area>` filters; `--json` prints the response; with
  the app unreachable it prints "the app is not answering", the local facts and the worker's refusal reason through its
  template, exit 1. On a fresh install (e2e) it exits 0 with `backups` `ok` (first backup present, no "due" note) and
  `price-sources` `warn`.
- [ ] **Implement; commit.**

### Task 18.6: The Status view and the status bar

- [ ] **Failing tests** (Testing Library, one shared query key `['status']`, 60 s refetch and on focus, fake timers):
  - The view: loading, empty and error states; "checked N s ago" from `generatedAt`; a failed refetch keeps the last
    report marked "stale, checked N min ago"; with no report, "the app is not answering".
  - Cards grouped by area, worst first, each a labelled region with the state as text before the summary; a non-ok card
    shows summary and fix; an `ok` card with a note shows it; the copy button copies exactly the command and shows
    "Copied"; with the clipboard unavailable the command is shown selected; focus is visible on every control.
  - `off` checks fold into one line naming each with its reason ("not set up: SearchApi"; "awaiting verification for
    this build: browser provider"); the container-mode backups card stays its own card.
  - Provider cards reuse the Providers view's usage wording and link to it.
  - "Send test" only on the email card, disabled while sending, with distinct messages for sent, 409 ("email is not
    set up"), 429 ("hourly email limit reached") and failed.
  - The bar, from the same query and `barSummary`: "Status: n failing", the quieter "Status: n to check", the area named
    when one item ("Status: consent to check"), nothing for `ok` checks with notes; after a failed refetch "Status:
    stale, checked N min ago"; with no report "Status: app not answering"; never a clean state from stale data; each
    links to the view.
  - No banned word; 375 px layout.
- [ ] **Implement; commit.**

### Task 18.7: Docs

- [ ] `docs/setup.md` §11 "Operating it": the Status view and `gmt status` first (what each area means, the data
  check's six-bucket counts, the "(n reused from earlier runs)" note and both age ends, the off reasons, the browser
  window line on the worker card, the stagger warning, the bar); `curl /api/health` stays for scripts and
  Docker. The wording test passes.

## 9. Pinned review-focus tests

- No key, password, database path, `SOCS` value, or vendor, worker, file or SMTP text in any status response (Task 18.1).
- Status never spends, calls a vendor or loads a page (Task 18.3's route test).
- A worker answering late is `unreachable` at 2 s, not a hang (Task 18.3).
- A provider awaiting verification is `off`, never `fail`; `degraded` is `fail` everywhere (Task 18.2).
- The data check never says "fresh", "complete" or "all"; uses the six core buckets; warns on oldest age and on
  `R + S + U` over 20%; never `ok` for a `skipped_*` latest row (Tasks 18.1, 18.2).
- The consent email at most once a London day, via `sendSystemNotice`, with no `operator_notifications` row and no
  migration (Task 18.4).

## 10. Definition of done

- `pnpm --filter @gmt/core test` (100%), `pnpm --filter @gmt/engine test`, `pnpm --filter @gmt/api test`,
  `pnpm --filter @gmt/web test`, `pnpm --filter @gmt/cli test` green at their thresholds; core mutation ≥ 80% on
  `sortChecks`, `barSummary` and the state rules: their files move from this brief's front-matter `pending` to its
  `mutate` field (adding the state rules' file when it is written), and `packages/core`'s Stryker `mutate` lists them;
  `scripts/check-mutation-globs.mjs` fails once this brief's `status:` is `merged` with any entry still `pending`, and
  fails a `mutate` entry that core's Stryker list leaves out, so the move cannot be skipped (ts3-005, review S13).
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`, `pnpm test`.
- On the operator's Mac (native mode): the Status view shows every area; stopping the worker turns `worker` to `fail`
  with `pnpm gmt start` as its fix within 60 s and the bar shows "Status: worker failing"; `pnpm gmt status` exits 1
  then, and 0 after the restart.

## 11. Open questions

None.
