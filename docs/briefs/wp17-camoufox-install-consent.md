---
wp: 17
title: Camoufox install, consent capture, the worker's caps and the Linux worker
owner: opus
depends_on: [16a, 16b]
spec_sections: ["§2 Method", "§2 Caps across callers", "§2 Consent", "§2 Recordings first", "§2 Labels", "§2 Costs", "§9 item 9", "§9 CI matrix", "§12 Where settings live", "§13 Native local mode", "§13 The camoufox worker", "§16", "§17 revision 36"]
reviewers: [provenance-auditor, provider-integration-expert, security-reviewer, devops-reviewer, cost-and-budget-reviewer, test-strategy-reviewer, code-architect, product-owner]
mutate: {"@gmt/camoufox-worker": ["src/monthly.ts"], "@gmt/cli": ["src/camoufox/**"]}
pending: {"@gmt/camoufox-worker": ["src/consentLine.ts"]}
status: open (Tasks 17.1–17.4, 17.6, 17.7, 17.9 and 17.10 built; research 17.0c, Task 17.5 and Task 17.8 open)
---

# WP17: Camoufox install, consent capture, the worker's caps and the Linux worker

Written 2026-10-19 against spec revision 36 and plan decisions 1–83, after WP16a (the shared `core` camoufox pieces:
`CAMOUFOX_BUILDS`, `FLAGS`, `flagsFor`, `startChecks`, `SHARED_WORKER_SETTINGS`, `effectiveSharedSettings`,
`sharedSettingDiffs`, `startRefusalSchema`, `START_REFUSAL_TEXT`, `workerDataDir`, `billingMonthWindow`, every
`workerStatusSchema` field this package fills, `readWorkerStatus`, and the worker reading its monthly caps and billing
day) and WP16b (the `gmt` command and its worker-refusal helper), and revised after review rounds 1 to 3 (every finding
answered in the review directories' `resolutions.md`; research 17.0a and 17.0b answered
on 2026-10-19 and folded into §0). It builds the operator's chosen item 2 (guided consent capture) and the parts of
items 1 and 3 that concern the browser provider: installing the pinned Camoufox on a clean machine, the worker's own
monthly caps across every caller (decision 82), running the worker as a service, and running it on Linux, headless,
including on a machine with no display. Every WP14 and WP15 limit holds unchanged (decisions 68–70): the signed-out
profile, `SOCS` set and read back by value, the navigation guard, the classifier's stops, the cool-downs by cause, no
proxies, no challenge ever solved or clicked, the page spacing and the caps.

## 0. What research 17.0a and 17.0b settled (2026-10-19)

- **Release.** `daijro/camoufox` tag `v152.0.4-beta.28`, published 2026-07-19, not a prerelease. Asset URL
  `https://github.com/daijro/camoufox/releases/download/v152.0.4-beta.28/camoufox-152.0.4-beta.28-<mac|lin>.<arm64|x86_64>.zip`.
  GitHub publishes a SHA-256 digest per asset; WP17 downloads each, hashes it and requires agreement with:

  | key | asset | bytes | sha256 |
  |---|---|---|---|
  | `darwin-arm64` | `…-mac.arm64.zip` | 312,626,286 | `8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd` |
  | `darwin-x64` | `…-mac.x86_64.zip` | 319,866,512 | `6e0efd66f6db46bece072827cb2c5a4851bca822ff4fed95b8a0c2fb6f61a3d4` |
  | `linux-arm64` | `…-lin.arm64.zip` | 653,814,950 | `3a105a2fc929e80a79b4b7fce2c93ed62c4fb2c877f3c1ed2a5d66a1c4fe968f` |
  | `linux-x64` | `…-lin.x86_64.zip` | 663,387,175 | `924f3109ccd6d47cd6a0384d67a345fadf975d48b6319f8dbbd5954c588982bd` |

  The operator's existing Mac bundle is the `darwin-arm64` asset (its installer-written `version.json` holds that
  digest; the directory suffix `8b7680a6` is its first 8 hex characters).
- **Archives.** The mac zip holds `Camoufox.app/…` (397 entries, no `version.json`, no symlinks; about 670 MB
  unpacked). The Linux zip is flat (707 entries): `camoufox-bin`, `camoufox`, `properties.json`, `libxul.so`,
  `omni.ja`, `fontconfig/{linux,macos,windows}/fonts.conf`, `fonts/{linux,macos,windows}/…`, no `version.json`, no
  symlinks; about 1.25 GB unpacked.
- **camoufox-js 0.11.5** (`dist/pkgman.js:44`) reads `CAMOUFOX_INSTALL_DIR` from the Node process's own `process.env`
  once, when the module is evaluated; the browser's `env` option has no effect on it. On Linux it expects, directly in
  the install directory, `version.json` (`{ version, release }`, release between `alpha.1` and `1`), `camoufox-bin`,
  `properties.json` and `fontconfig/<mac|lin|win>/`. It computes `FONTCONFIG_PATH` on every Linux launch, so
  `camoufoxPath()` and its download branch are reachable on every launch: a missing, empty or unsupported install
  directory starts an unawaited download that calls `fetch` synchronously, then `rmSync(INSTALL_DIR, { recursive })`,
  with failures retried silently inside the detached promise.
- **Fonts.** The Linux bundle names its fontconfig directories `linux|macos|windows`, but camoufox-js points at
  `fontconfig/mac` (absent), and each bundled `fonts.conf` resolves fonts relative to the process's working
  directory. The worker's launch `env` is spread after camoufox-js's own variables, so a `FONTCONFIG_FILE` it passes
  takes effect. camoufox-js 0.13.0 has the same code.
- **Linux libraries.** Firefox needs, even headless, playwright-core 1.59.1's list for Ubuntu 24.04: libasound2t64
  libatk1.0-0t64 libavcodec60 libcairo-gobject2 libcairo2 libdbus-1-3 libfontconfig1 libfreetype6
  libgdk-pixbuf-2.0-0 libglib2.0-0t64 libgtk-3-0t64 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1
  libxcb-shm0 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 (Debian
  12 adds libdbus-glib-1-2, libharfbuzz0b, libxtst6).
- **Headed on Linux.** The worker's browser env is `{ HOME, PATH, TMPDIR, LANG }`, so a headed window has no display
  variables unless the `consent` command passes them.
- **Library check.** Firefox's Linux executable is a stub that loads `libxul.so` at run time, so the GTK, X11, ALSA
  and D-Bus libraries are `libxul.so`'s dependencies: `ldd camoufox-bin` alone reports nothing missing. playwright-core's
  own host check runs `ldd` over every executable and `.so` in the browser directory; WP17 does the same.

## 1. Goal

On macOS or Linux, where the machine's `<os>-<arch>` has verification flags for the pinned build, `gmt setup` (with
the browser provider chosen after its costs) installs the pinned Camoufox from `CAMOUFOX_BUILDS`, takes consent, writes
`worker.env` with the shared key and settings, and runs the worker as a user service once its start checks pass; the
worker enforces the camoufox monthly caps itself; consent comes from a person's click observed read-only, or by export
and import, or by a server-side check in a region with no consent screen; and the other three `<os>-<arch>` entries
earn their flags through recording sessions.

## 2. Scope

**In**

- The CLI's install planner (§0's facts), the CLI-owned layout, `update`'s Camoufox step and the old bundle's removal,
  the free-space, `unzip` and Linux-library checks.
- The worker: `run.ts` sets `CAMOUFOX_INSTALL_DIR`; `ensureInstallLayout` per OS; Linux fonts;
  `assertSupportedPlatform`; the pin from `CAMOUFOX_BUILDS`; `run.ts check --json`; `start-refusal.json`; the deleted
  `DEFAULT_BINARY_BUILD` and `CAMOUFOX_BINARY_BUILD`; enforcing the monthly page and scroll caps across every caller
  over the ledger's billing month (decision 82; WP16a's worker already reads and reports the caps and the billing day);
  `/v1/status` filling the fields WP16a put in `workerStatusSchema` (`osArch`, `build`, `consent` with `boundedBy`
  `cookie`, `capture` or `check` and null once voided, `monthly`, `appInstances`), with `flags` the running entry's. In
  `packages/core/src/camoufox/protocol.ts` this package only adds: the worker answer kind `monthly-cap` (HTTP 429, with
  the cap and the window's end; the adapter maps it to `BudgetExceeded` at `provider-month`), which WP16a's schema
  lacked and decision 82's refusal needs, landed in its own first commit with the adapter's answer map so the app and
  the worker read it from the same change (decision 76's rule: the schema before any worker emits it); and, in
  `builds.ts`, the `LANDING_VERIFIED` flag WP16a §3 listed. No existing field changes.
- `run.ts session export | seed | merge` for the recording sessions (Task 17.8).
- The `landing` page kind and `LANDING_VERIFIED`; `consentCaptureGuard` and the `consent-research` recorder kind;
  research 17.0c; then the `consent` command with `export`, `import` and `check`; `gmt consent` with the service stop,
  restart and refusal clearing.
- The browser-provider row of the wizard, `worker.env`, the worker service, key rotation under `--reconfigure browser`.
- The provenance notes' wording (spec §2 Labels) with their docs-equals-constant test.
- The recording sessions for `darwin-x64`, `linux-arm64`, `linux-x64` (`Dockerfile.recorder`), and their flags.
- The `camoufox-install` CI job.
- Docs: `docs/setup.md` §14 around `gmt setup` and `gmt consent`, the manual steps as an appendix; `docs/providers.md`
  platforms line.

**Out**

- WP16a's `core`/`providers` pieces (consumed here, not changed).
- The status report and view, the consent email and `apps/cli/src/commands/status.ts` (WP16b's local status, then
  WP18's; the refusal report and its boot-out are WP16b's helper, which this package calls from `start` and `update`).
- Windows (decision 78).
- Any change to page reading, the grammar, the planner or the per-execution caps.

## 3. Spec sections and plan decisions

§2 Method, Caps across callers, Consent, Recordings first, Labels, Costs; §9 item 9 and the CI matrix's
`camoufox-install`; §12 "Where settings live" (the worker half, key rotation); §13 the worker service and paragraph;
decisions 73, 74, 75, 82.

## 4. Interfaces consumed

WP16b §5 exactly (`Platform`, `Paths.workerData`, `Paths.camoufoxRoot`, `ServiceSpec`, `ServiceManager.facts`, `Action`,
`Plan`, `apply`, `Ask`, `Runner`). WP16a §3 exactly (`OsArch`, `CAMOUFOX_BUILDS`, `bundleDirName`, `versionOf`,
`REDIRECT_HOSTS`, `FLAG_NAMES`, `FLAGS`, `flagsFor`, `startChecks`, `SHARED_WORKER_SETTINGS`, `effectiveSharedSettings`,
`sharedSettingDiffs`, `startRefusalSchema`, `START_REFUSAL_TEXT`, `workerDataDir`, `APP_INSTANCE_HEADER`,
`workerStatusSchema`, `billingMonthWindow`). WP16b's `apps/cli/src/worker/refusal.ts` (`readStartRefusal`,
`refusalLine`, `bootOutRefused`). The worker's `socs.ts` (`parseCapture`, `writeCapture`),
`lock.ts`, `pacer.ts`, `cooldown.ts`, `install.ts`, `launch.ts`, `selectors.ts`, `guard.ts`, `classify.ts`, `record.ts`,
`run.ts`. `CONSENT_FIX` (`packages/core/src/camoufox/consentFix.ts`: `{ command: 'pnpm --filter @gmt/camoufox-worker capture-socs',
doc: 'docs/setup.md#set-it-up-macos' }`, one constant shared with WP18's PR): the Status view's consent card, the worker card's
`consent-*` refusals and the consent email use it through `consentFixText()`; when Task 17.5 lands a `pnpm gmt consent`,
WP17 changes that one constant and nothing else in the report (WP18 branch review, V1).

## 5. Interfaces produced

```ts
// apps/camoufox-worker/src/consentLine.ts (beside socs.ts; the CLI never imports it)
export const CONSENT_LINE_PREFIX = 'gmt-socs-v1.';
export const consentLineSchema: z.ZodType<ConsentLine>; // { socs: SocsFields, capturedAt, mark }, strict
export function rejectionMark(value: string): 'reject' | 'accept' | 'unknown'; // pure, from 17.0c; the value alone
export function encodeConsentLine(c: ConsentLine): string;
export function decodeConsentLine(line: string): ConsentLine | ConsentLineError; // recomputes the mark

// apps/camoufox-worker/src/consentDriver.ts — the consent command's only browser access
export interface DisplayEnv { x11: { DISPLAY: string; XAUTHORITY?: string } | null; wayland: { WAYLAND_DISPLAY: string; XDG_RUNTIME_DIR: string } | null }
export interface ConsentDriver {
  launchHeaded(display: DisplayEnv): Promise<void>;
  load(url: string): Promise<void>;
  mainFrameHosts(): readonly string[];        // every host the main frame navigated to, in order
  snapshotView(): Promise<PageView>;          // the classifier's input, read-only
  socsCookie(): Promise<SocsFields | null>;   // SOCS by name and domain; other cookies dropped as read
  accountCookieSeen(): Promise<boolean>;
  closed(): boolean;
  close(): Promise<void>;
}

// apps/camoufox-worker/src/monthly.ts — the counts file `<workerData>/monthly.json` (0600, beside the pacer's file)
export interface MonthlyCounts { windowStart: IsoDateTime; pages: number; scrolls: number }
export interface MonthlyCaps { pages: number; scrolls: number; billingDay: number }
// Pure: counts outside billingMonthWindow(now, billingDay) are a new window at zero. A page is refused only on the page
// cap; its scroll allowance is clamped to what the scroll cap leaves (0 still reads the first block).
export function admit(c: MonthlyCounts, caps: MonthlyCaps, now: IsoDateTime, scrollRequest: number):
  { kind: 'ok'; scrollAllowance: number; reserved: MonthlyCounts } | { kind: 'monthly-cap' };
export function settle(reserved: MonthlyCounts, allowance: number, scrollsMade: number): MonthlyCounts; // reserved − (allowance − made)
// Reads the file: 'absent' only when no pacer file exists either; a missing file beside a pacer file, invalid JSON, a
// schema failure, a mode wider than 0600 or a read error is 'refused', and the file is left as it is.
export function readCounts(dir: string): Promise<MonthlyCounts | 'absent' | 'refused'>;

// run.ts entries added: 'check' (--json: prints a startRefusalSchema result or { ok: true }), 'consent'
// (with 'export', 'import', 'check' subcommands), and 'session' ('export' prints { lastPageAt, windowStart, pages,
// scrolls } as one JSON line; 'seed' reads that line on stdin and sets only this data directory's last-page time;
// 'merge' reads it on stdin, takes the later last-page time and adds the counts when the windows match, under the
// worker's lock and refused while the service runs). run.ts reads DISPLAY, XAUTHORITY, WAYLAND_DISPLAY and
// XDG_RUNTIME_DIR for the 'consent' entry only, into DisplayEnv by group.
```

`/v1/status` `flags` is the running entry's (`flagsFor(osArch, build)`); WP18 never infers a flag from an absent field.

## 6. Files

Create: `apps/camoufox-worker/src/{consent,consentLine,consentDriver,consentGuard,fonts,startRefusal,monthly}.ts`
(+ tests); `apps/camoufox-worker/Dockerfile.recorder`; `apps/cli/src/camoufox/{install,layout,workerEnv,offer,libs}.ts`
(+ tests); `apps/cli/src/commands/consent.ts`.

Modify: `packages/providers/src/camoufox/provider.ts` (the notes' wording; `monthly-cap` → `BudgetExceeded` at
`provider-month`; a grid answer reporting the monthly scroll allowance spent raises it for the next tile); `apps/camoufox-worker/src/{platform,paths,
install,launch,selectors,run,server,classify,session,guard,record,recordArgs,pacer,gridPage,status}.ts`, its
`package.json` (`consent` script) and `stryker.config.json` (`src/consentLine.ts`, `src/monthly.ts`);
`scripts/check-boundaries.mjs` (the `run.ts` write exception); `apps/cli/src/commands/{setup,update,start,stop,
uninstall}.ts` (not `status.ts`); `apps/cli/src/args.ts` and `apps/cli/src/cli.ts` (registering `consent`);
`apps/cli/src/services/{set,specs}.ts` (the worker service in the one service list); `apps/cli/src/exec/system.ts`
(the download and unpack steps, if they need more than WP16b's);
`.github/workflows/ci.yml` (`camoufox-install`); `scripts/workflows.test.mjs`; `docs/setup.md` §14;
`docs/providers.md`; the spec's and docs' provenance note copies with their docs test.

## 7. Tasks

The order is fixed: 17.1, 17.2, 17.3, 17.4 (the landing view, the guard and the `consent-research` recorder kind), research 17.0c, then 17.5
only if 17.0c proves a mark; 17.6–17.10 follow.

### Task 17.1: The verified install (first failing test)

- [ ] **Failing tests:**
  - **First failing test (§16):** a `download` whose bytes hash differently from the entry is refused, the partial file
    deleted, and no `unpack` or `rename` runs (`systemExecutor`, loopback HTTP server).
  - A redirect to a host outside `REDIRECT_HOSTS` or to `http:` is refused.
  - The planner picks `<os>-<arch>` from `Platform` and refuses when free space is under `bytes + unpackedBytes`, naming
    both figures.
  - Before unpacking, the archive is re-hashed and `unzip -Z1` is read: an absolute entry, a `..` entry or one resolving
    outside the target is refused (fixture zips).
  - The plan unpacks into a 0700 `.tmp-<random>/` under `camoufoxRoot`, writes the bundle's `version.json` from
    `versionOf(entry)` (`{ version, build: release, release, sha256 }`; the test checks every `CAMOUFOX_BUILDS` entry,
    with `152.0.4`/`beta.28` only as the expected literal), and renames into `browsers/official/<bundleDirName>/` in one
    step; the renamed directory passes `ensureInstallLayout` for its OS (fixture trees made from §0's entry lists).
  - The layout: on macOS the root's `Camoufox.app` symlink and `{ version, release }` `version.json`; on Linux nothing
    beyond the bundle. An existing bundle with the same `version.json` sha256 plans nothing; a different one is
    reported and never overwritten.
  - Linux libraries: `ldd` runs over `camoufox-bin` and every `.so` in the bundle; a fixture where only `libxul.so`
    reports `libgtk-3.so.0 => not found` refuses, naming the missing sonames and §0's apt line; `unzip` missing names its
    install line.
  - `update`'s Camoufox step (placed by WP16b after the build and before the restart): a changed entry whose `FLAGS` are
    set for that build installs it, with no keep option, and the previous bundle is removed only after `waitHealthy`
    passes; a changed entry without flags installs nothing, keeps the old bundle, and says "the browser provider stays
    off on <os>-<arch> until recordings for <build> land", and the test asserts no download action and the `fetch` spy at
    zero; the message is pinned for both cases.
- [ ] **Implement; commit `wp17: verified camoufox install`.**

### Task 17.2: The worker's install directory, Linux fonts, flags, start checks and refusals

- [ ] **Failing tests:**
  - `run.ts` refuses an inherited `CAMOUFOX_INSTALL_DIR` (the existing message), then sets
    `process.env.CAMOUFOX_INSTALL_DIR` to `camoufoxRoot` (macOS) or `camoufoxRoot/browsers/official/<bundleDirName>`
    (Linux) before dispatch; `launch.ts` asserts it; the import-seam test asserts camoufox-js's own resolved
    `INSTALL_DIR`. The boundary script accepts this one write in `run.ts` and refuses any other.
  - A `fetch` spy (recording calls; the download branch calls it synchronously in the first `launchOptions`) sees zero
    calls through `prepareLaunch`/`launchContext` against the macOS and Linux layout fixtures, and on the refusal paths:
    a missing bundle and a mismatched bundle each exit 78 (`layout`, `build-mismatch`) with `ensureInstallLayout` run
    before any `launchOptions` call. `install.ts`'s comment records the `rmSync` consequence.
  - Linux: the launch writes `<workerData>/fonts.conf` from the bundle's `fontconfig/macos/fonts.conf` with every
    `<dir prefix="cwd">` made absolute to `<bundle>/fonts/macos`, and passes `FONTCONFIG_FILE` in the browser env; the
    worker keeps `os: 'macos'`; macOS's launch env is unchanged.
  - `assertSupportedPlatform('win32')` refuses.
  - The worker's pin is `CAMOUFOX_BUILDS[osArch].build`; `DEFAULT_BINARY_BUILD` is gone; a `worker.env` still naming
    `CAMOUFOX_BINARY_BUILD` is refused with "remove CAMOUFOX_BINARY_BUILD: the build now comes from CAMOUFOX_BUILDS".
  - A worker on `linux-arm64` with `FORM_VERIFIED` true and `GRID_VERIFIED`, `NO_FLIGHTS_VERIFIED` and
    `CHEAPEST_FLOW_VERIFIED` false: a grid request is refused (409), a no-flights page is not stored as `no_data`, the
    cheapest flow is not used.
  - The start uses `core`'s `startChecks` (`core/camoufox/start.ts`; its `StartFacts.consent` is `{ kind: 'voided' }`
    with no expiry for a voided record, or `{ kind: 'socs' | 'not-shown', expiresAt }`, so the worker passes a voided
    record as it is and never makes up an expiry); each `START_REFUSAL_REASONS` value exits 78 after writing
    `<workerDataDir(home)>/start-refusal.json` (0600, `{ reason, at }` only); a successful start removes it; `run.ts
    check --json` prints the same result without starting (or `{ "ok": true }`). No secret or free text is in the file
    (sentinel).
  - `/v1/status` reports `osArch`, `build`, `flags` (the running entry's), `consent` (kind `socs`: `expiresAt` the
    earlier of the cookie's expiry and `capturedAt` + 13 months, `boundedBy` `cookie` or `capture`; kind `not-shown`:
    `checkedAt` + 13 months, `boundedBy` `check`; kind `voided`: `expiresAt` and `boundedBy` null), `monthly`,
    `appInstances`. The worker's status parses under `core`'s `workerStatusSchema` as WP16a left it (the shared fixture
    of Task 16a.5 is regenerated from this worker and must still parse); `packages/core/src/camoufox/protocol.ts`
    changes only by adding answer kinds (`monthly-cap`, §2).
- [ ] **Implement; commit.**

### Task 17.3: The worker's monthly caps (decision 82)

- [ ] **Failing tests** (fake clock, a temporary data directory, a stub page):
  - Window: the counts use `billingMonthWindow(now, CAMOUFOX_BILLING_DAY)`, the ledger's rule; at billing day 1,
    `2027-03-31T23:59:59.999Z` counts in March's window and `2027-04-01T00:00:00.000Z` starts April's at zero (no
    London shift in British Summer Time), and `2027-10-31T23:59:59.999Z`/`2027-11-01T00:00:00.000Z` likewise; at billing
    day 15, `2027-10-14T23:59:59.999Z`/`2027-10-15T00:00:00.000Z`; at each boundary the worker's window equals `db`'s
    `monthWindow` for the same instant and billing day.
  - Admission order: the page and its clamped scroll allowance are written to `monthly.json` (temporary file, 0600,
    rename) before the page loads: a stub page that throws, and one that kills the process, after admission leave the
    reservation on disk; after a normal page the counts settle to the scrolls made. A worker restart reads the same
    counts back (round trip).
  - Fail closed: `monthly.json` missing while the pacer's file exists, truncated, invalid JSON, failing its schema,
    unreadable (mode 000), or widened to 0644: every page answers `monthly-cap`, nothing loads, the file is byte-for-byte
    unchanged and never rewritten with zeros, and `/v1/status` reports `monthly.readable` false; with neither file (a new
    install) the window starts at zero.
  - Caps: the page cap refuses the page that would pass it (`monthly-cap` before any load; the adapter maps it to
    `BudgetExceeded` at `provider-month`); a refused request leaves the counts unchanged. With page room but the scroll
    cap spent, the page loads, reads its first block and makes no scroll. With S scrolls left and a request of 30, the
    allowance is S, the page ends `allowance` with its read views stored, its row's `scroll_count` is S, and the adapter
    raises `BudgetExceeded` at `provider-month` for the next tile.
  - Concurrency: two callers with `Promise.all` and one page left: exactly one admitted, the other `monthly-cap`.
  - A `consent`, `consent check` or `record --kind consent-research` load counts as a page. A `/v1/status` read leaves
    the counts file unchanged. A second app instance id in one window is reported in `/v1/status`, not refused.
  - `admit`, `settle` and `readCounts` are mutation-tested.
  - Wording (WP16a review R20): once the worker refuses a page at its monthly cap, `.env.example` and spec §12's block
    (the docs test keeps them equal) say so again: `CAMOUFOX_MONTHLY_PAGE_CAP` and `CAMOUFOX_MONTHLY_SCROLL_CAP` "the
    worker enforces it too", and `CAMOUFOX_BILLING_DAY` "in the ledger and the worker", in place of WP16a's "the worker
    reports it (and enforces it from WP17)"; `docs/api-limits.md`'s camoufox caps line drops its "from WP17".
- [ ] **Implement; commit.**
- [ ] **Implement; commit.**

### Task 17.4: The landing view, `consentCaptureGuard`, the `consent-research` kind and the consent driver

- [ ] **Failing tests:**
  - The classifier recognises the landing page (`https://www.google.com/travel/flights?hl=en-GB&gl=<POINT_OF_SALE>`)
    positively as `landing` from dated selectors gated by `LANDING_VERIFIED` (false until 17.0c's recordings set it, so
    until then nothing reads as `landing`); anything not positively recognised is not `landing`.
  - The guard, built only for the `consent` command and the `consent-research` kind, admits by host, path and method:
    document navigations and form POSTs to `consent.google.com` (`/save` included) and the redirect to
    `www.google.com/travel/flights`; it refuses every other host; the server path's guard still refuses `/save`
    (existing test kept).
  - `record --kind consent-research` (headed, local-only output, under the guard and the worker's lock, pacer, monthly
    counter and cool-downs) attaches a request listener that saves each request's method, path and form field names, never values,
    except the one value that differs between a "Reject all" and an "Accept all" session, compared in memory before
    saving; a test with a fake request stream shows no other value is ever written.
  - `ConsentDriver` is the consent module's only browser access: `consent.ts` imports no Playwright type (a grep test),
    and the real implementation is the only holder of page handles.
  - Display: `launchHeaded` passes `DISPLAY` and `XAUTHORITY` only when `DISPLAY` is set, `WAYLAND_DISPLAY` and
    `XDG_RUNTIME_DIR` only when `WAYLAND_DISPLAY` is set, never `DBUS_SESSION_BUS_ADDRESS` (a test per session type
    showing the other group absent); with neither it refuses, pointing at export and import; the headless worker's env
    is unchanged; `run.ts` reads the four only for the `consent` entry (a test that `main` never reads them).
- [ ] **Implement; commit.**

### Research 17.0c: the rejection mark (after Task 17.4; Task 17.5 is not dispatched without it)

- [ ] The operator runs `pnpm --filter @gmt/camoufox-worker record --consent-research` once, with the worker stopped
  (`pnpm gmt stop --only worker`) on a machine with a display: it opens two headed sessions in throwaway profiles, the
  first asking for "Reject all", the second for "Accept all", each closed by the operator once the choice is made. A
  session is kept only with exactly one consent submission and a SOCS set after it within 10 minutes; the one recording
  stays local and is backed up (`recordings:backup`), and counts two pages. The same sessions record the landing view,
  which sets `LANDING_VERIFIED`.
- [ ] If the two `SOCS` values differ in a stable way that the value alone shows, write `rejectionMark(value)` with tests
  on both recordings, and dispatch Task 17.5. If the mark is not derivable from the value alone, the consent command is
  not built: `capture-socs` stays the capture path, the docs say so, and Task 17.5 shrinks to `import` of a
  `capture-socs` file with the operator's typed confirmation, which the operator rules on.

### Task 17.5: The `consent` command, `export`, `import` and `check` (after 17.0c)

- [ ] **Failing tests** (fake `ConsentDriver`, fake clock, loopback fixture pages):
  - It takes the worker's lock and refuses while held; during an active cool-down it refuses, naming its end; it waits
    out the page spacing from the persisted last-page time and writes that time after its load; the load counts in the
    monthly counter. Capture then worker: the worker's next page waits the spacing.
  - `gmt consent` stops the worker service first; after a successful capture it clears any `consent-*`
    `start-refusal.json` and starts the worker; on any other outcome (refusal, thrown error) it restores the previous
    state; tested for a running and a stopped service.
  - After the one `load`, the driver sees no call but reads (a spy failing the test on anything else).
  - Consent host seen, then `SOCS` whose `rejectionMark` is `reject`: fields parsed with `parseCapture`, written 0600 with
    `capturedAt`, profile deleted.
  - `accept` or `unknown` mark; `SOCS` with no consent host seen; a consent page left unclicked for 10 minutes; a
    challenge page; a page that never loads (offline); a first view not positively recognised; the window closed with no
    `SOCS`; an account cookie appearing: nothing written, each with its own message; the account-cookie case also
    deletes the profile at once.
  - First stable view `landing`, no consent host, no `SOCS`: the operator is asked to confirm, and on yes the `{
    consent: "not-shown", checkedAt }` record is written at once; an unrecognised first view with no consent host and no
    `SOCS` writes nothing.
  - The profile is deleted on every path, including a throw during deletion (retried once, then reported), and the
    start-up sweep removes a leftover.
  - `export` requires `gmt setup`'s install (it refuses, naming `pnpm gmt setup`, when the layout is missing; the worker
    never downloads) and prints exactly one line, `gmt-socs-v1.` + base64url of `{ socs, capturedAt, mark }`, and nothing
    else on stdout.
  - `import` reads stdin only (an argument is refused), at most 4 KB; `consentLineSchema` refuses a wrong prefix, an
    extra field, a name other than `SOCS`, a value over its length bound or outside its character set, a domain other
    than `.google.com`, a path other than `/`, an expiry later than `capturedAt` + 13 months, and an expired cookie; it
    recomputes `rejectionMark(socs.value)` and refuses a line whose carried mark differs or is not `reject` (an
    Accept-all value carrying a forged reject mark is refused); a valid line writes `socs.json` keeping `capturedAt`.
  - `check` (server): one headless load of the landing page under the worker's lock, pacer, monthly counter, guard,
    classifier and cool-downs, at most once an hour: the last check's time is persisted beside the pacer's last-page
    time, so a second process within the hour is refused naming the time it may run (a test with two processes);
    writes the not-shown record
    only when the first stable view is `landing` with no consent host and no `SOCS`; a consent page says "this server's
    region shows a consent screen; capture on a desktop and use gmt consent import"; a challenge page starts its
    cool-down as on the server path.
  - Voiding: with a not-shown record, a consent page or a `SOCS` cookie after a page stops the worker as
    `consent-unhandled` and rewrites the record as `{ consent: "voided", voidedAt }`; `/v1/status` reports `voided`; the
    next start refuses `consent-voided`.
  - Secrets: the `SOCS` value, raw, base64url and as the line, appears in no output other than `export`'s one line (no
    stderr, log line, status body or file other than `socs.json`).
  - `encodeConsentLine`/`decodeConsentLine` round-trip (property test); `rejectionMark` and the codec are
    mutation-tested.
  - `gmt consent [export|import|check]` spawns `[<execPath>, --conditions=@gmt/source, --import, tsx,
    <checkout>/apps/camoufox-worker/src/run.ts, consent, …]` with standard streams inherited, an environment of `PATH`,
    `HOME` and the display variables present (by group), and imports no worker code (a CLI test of the spawn env).
- [ ] **Implement; commit.**

### Task 17.6: The browser provider in `gmt setup`, the worker service and key rotation

- [ ] **Failing tests:**
  - The prompt is offered only when `flagsFor(osArch, CAMOUFOX_BUILDS[osArch].build).FORM_VERIFIED`; otherwise setup
    prints once "The browser provider is not available on this machine yet (no recordings for <os>-<arch>); SearchApi
    and Travelpayouts work", downloads and installs nothing and leaves `CAMOUFOX_ENABLED` unset; a later `setup` or
    `update` offers it once the flags land.
  - Before the question, on every machine, the §2 costs summary is printed (a test that the question never precedes
    it); on a machine with no display the server text of spec §2 follows, and the provider is enabled only on a typed
    `yes` (interactive) or `acceptServerAddress: true` (answers); `--non-interactive` without it leaves the provider off.
  - Choosing it runs, in order: the consent method explained (desktop capture; or, with no display, export on a desktop
    that has run `gmt setup` with `unzip` and, on Linux, the libraries, or `capture-socs`, with the effort of each, then
    import, or `gmt consent check`), the install plan, `worker.env` (0600) with a generated `CAMOUFOX_WORKER_KEY` (48 hex
    characters) mirrored into `app.env` with `CAMOUFOX_WORKER_URL=http://127.0.0.1:8090`, the shared settings equal on
    both sides (`sharedSettingDiffs` empty), the consent step, and only after consent succeeds `CAMOUFOX_ENABLED=true` and
    the worker service. An interrupted step leaves the provider off, and `pnpm gmt setup --reconfigure browser` resumes
    it (test: status reads `off`, `not-set-up`, never `fail`). The line holds only the `SOCS` cookie choice, not account
    data; the docs say to move it by pipe or clipboard, never as an argument or in a ticket.
  - The worker service: argv `[<execPath>, --conditions=@gmt/source, --import, tsx, <checkout>/apps/camoufox-worker/src/
    run.ts, main]`, working directory the worker package, environment exactly `{ PATH, HOME }`; systemd
    `RestartPreventExitStatus=78`; launchd `KeepAlive` `{ SuccessfulExit: false }` with `ThrottleInterval` 600 (the
    rendered plist is tested). `gmt start` and `update` call WP16b's `bootOutRefused` while `start-refusal.json` exists
    and print `refusalLine` ("refused, not retrying: <summary>" from `START_REFUSAL_TEXT`); `gmt status` already does
    the same through WP16b's local status, which this package does not edit. `gmt start` runs `run.ts check --json`
    first and plans no start when it reports a reason, printing that reason's `START_REFUSAL_TEXT` summary and fix.
  - With `monthly.readable` false, `--reconfigure browser` offers to rewrite `monthly.json` from the app's own ledger
    for the current window (`GET /api/providers`' camoufox page and scroll usage), stating that pages other apps caused are
    not in that figure; it writes nothing without a yes.
  - Key rotation in `--reconfigure browser`: asked, yes by default when `gmt status` reports "keys differ"; the plan is
    stop both services, write `worker.env` then `app.env` through `writeSecretFile` (temporary file, 0600, rename) with
    24 bytes from `crypto.randomBytes` as hex, start the worker, then the app. Interrupted after each action, the next
    `gmt status` names "keys differ" and a re-run repairs it; neither the new nor the old key appears in any output
    (sentinel, raw and base64url).
  - `uninstall` removes the worker service; `update` re-renders it and re-offers the provider when flags land.
- [ ] **Implement; commit.**

### Task 17.7: Provenance notes

- [ ] **Failing test:** the `camoufox` list and grid notes say "on the machine running this app's browser worker, from
  that machine's address" and equal spec §2 Labels (the docs-equals-constant test extended); no note says "operator's IP".
- [ ] **Implement; commit.**

### Task 17.8: The recording sessions (operator, with the implementer)

- [ ] **Before each session:** `pnpm gmt stop --only worker` for the host worker (the worker alone: a native app keeps
  running); no camoufox run active (`GET
  /api/executions/active` and the definitions' providers); refuse while the host worker's persisted cool-down is
  active; seed the session's last-page time from the host's (`run.ts session export` on the host piped into `run.ts
  session seed` in the session's container or throwaway `HOME`). **After:** pipe the session's `run.ts session export`
  into the host's `run.ts session merge` (the later last-page time, the counts added) before `pnpm gmt start --only
  worker`, or wait
  one spacing interval when the windows differ; record the session's page and scroll counts in the session record.
  Tests: seed sets only the last-page time; merge adds counts and keeps the later time; merge refuses while the host
  worker runs or the line fails its schema.
- [ ] `apps/camoufox-worker/Dockerfile.recorder`: `FROM node:22-slim` pinned by digest, §0's Linux libraries and
  `unzip`, Node and pnpm; mounts (documented `docker run` line) only `apps/`, `packages/`, `pnpm-lock.yaml`,
  `package.json`, `pnpm-workspace.yaml` read-only and `fixtures/recorded/` read-write, plus a named volume for the worker
  data; no published ports. A start-up check refuses when any `.env`, `app.env` or `worker.env` is visible.
- [ ] `linux-arm64` (native arm64 container) and `linux-x64` (`--platform linux/amd64`): `gmt setup` inside the
  container (the provider chosen, the install from `CAMOUFOX_BUILDS`), `SOCS` by `gmt consent import`, then the recorder
  kinds of spec §2 (2), (4), the landing view and `--grid`, headless with the generated `fonts.conf`.
- [ ] `darwin-x64`: under a throwaway `HOME` (so `camoufoxRoot`, `workerData` and `socs.json` are separate from the
  operator's), with an x86_64 Node build run under `arch -x86_64`, asserting `process.arch === 'x64'` at the start;
  `gmt setup` there installs the `darwin-x64` entry; `SOCS` by `gmt consent import`; the same kinds; then
  `recordings:backup` and the throwaway tree removed.
- [ ] `recordings:backup` after each session.
- [ ] One commit per entry sets its `FLAGS` set (build and flags) to what its recordings prove, naming the files by
  date.
- [ ] One live grid page per Linux entry through an app running inside the same container (app and worker on its
  loopback) prices its cells.

### Task 17.9: The `camoufox-install` CI job

- [ ] `ci.yml`: on paths `packages/core/src/camoufox/builds.ts`, `apps/cli/src/camoufox/**`, `apps/camoufox-worker/src/
  {install,launch,fonts,run}.ts` and weekly (`schedule`); runners `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, and an
  Intel macOS runner if WP16b's Task 16b.0 found one (else the job's comment states `darwin-x64` is not exercised in
  CI); `actions/cache` keyed by the entry's sha256; the download step with `timeout-minutes` and one retry; the hash
  check; the library check; a launch through the worker's `prepareLaunch`/`launchContext` against a loopback page with
  the `fetch` spy asserting zero calls and, on Linux, `FONTCONFIG_FILE` set. The release hosts are on this job's
  allowlist only (WP16b's guard).
- [ ] **Commit.**

### Task 17.10: Docs

- [ ] `docs/setup.md` §14: "Set it up" is `gmt setup` (the provider row, its costs, when it is offered, the order of
  its steps, resuming with `--reconfigure browser`) and `gmt consent`; "On a machine with no display" (export on a
  desktop that has run `gmt setup`, or `capture-socs`, with the effort of each; then import; or `gmt consent check` in a
  region with no consent screen; the server text); "Linux" (headless, the libraries, the fonts, the recordings per
  `<os>-<arch>`); the monthly caps across every caller; sizes (313 MB / about 670 MB on macOS, 654 MB / about 1.25 GB on
  Linux); key rotation; the manual steps as an appendix. The wording test passes; the docs test pins the `gmt consent`
  subcommands.

## 8. Pinned review-focus tests

- The `consent` command never clicks, types, navigates after the one load, or evaluates script (Tasks 17.4, 17.5).
- A hash mismatch, a bad redirect or an escaping archive entry installs nothing (Task 17.1).
- No flag counts on a build or `<os>-<arch>` it was not recorded under (WP16a; Task 17.2).
- The camoufox-js download branch is never reached, including on refusal paths (Tasks 17.1, 17.2, 17.9).
- The monthly caps hold across callers, over the ledger's window, and fail closed on a bad counts file (Task 17.3).
- A forged mark is refused on import (Task 17.5).
- The worker key and the `SOCS` value appear only where named (Tasks 17.5, 17.6).

## 9. Definition of done

- `pnpm --filter @gmt/camoufox-worker test`, `pnpm --filter @gmt/cli test`, `pnpm --filter @gmt/core test` (100%),
  `pnpm --filter @gmt/providers test` green; `pnpm --filter @gmt/camoufox-worker mutate` ≥ 80% including
  `src/consentLine.ts` and `src/monthly.ts`; `pnpm --filter @gmt/cli mutate` ≥ 80% including `src/camoufox/**`; those
  entries move from this brief's front-matter `pending` to its `mutate` field, and `node scripts/check-mutation-globs.mjs`
  passes.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`, `pnpm test`.
- The `camoufox-install` job green on its runners.
- On the operator's Mac: `pnpm gmt setup` with the browser provider downloads and installs the `darwin-arm64` entry,
  `pnpm gmt consent` captures a rejection by the operator's click (after 17.0c), the worker service starts, and one grid
  page prices its cells.
- Task 17.8's sessions done and backed up, each entry's flags committed with their evidence named.

## 10. Open questions

None for dispatch. Research 17.0c decides whether Task 17.5 is built; if no mark derivable from the value exists, the
operator rules on the reduced scope stated there.

## 11. As built, after branch review round 1 (2026-10-25)

The review's rulings W1–W11 are folded into the code, the spec (revision 40) and plan decisions 75 and 77. Where the
build differs from the tasks above:

- **One install command in any app mode.** `pnpm gmt browser install [--keep-archive] [--wait|--force]` runs the one
  install sequence (`apps/cli/src/camoufox/installer.ts`) that setup, `--reconfigure browser`, update and the CI job
  also run; with `worker.env` present it also installs the gmt worker service. `pnpm gmt browser counts` rewrites the
  monthly counts through the worker's own `run.ts counts --json` entry (core's `monthlyCountsSchema`, the worker's
  lock). The CI entry `camoufoxInstall.ts` is gone; the manifest printer is `src/camoufox/printManifest.ts`.
- **The pin is data.** `packages/core/src/camoufox/pin.ts` holds the builds and flags with no import, so update reads
  the next commit's copy (`printManifest.ts --pin <file>`) and downloads that bundle before it stops the app.
- **Consent research.** A session is kept only after exactly one form submission to the consent host's `/save` and a
  SOCS set or changed after it. Its label is `prompted` (the button the session asked for, stated in the record's
  `note` as the instruction given), not a captured click: the consent driver exposes no script into the page, so the
  clicked control is not observable read-only; research 17.0c checks `differing` (kept only from the two `/save`
  submissions, short plain values under a non-token name) against the two SOCS values before a rejection mark is
  written. The research recorder gets the display groups through run.ts's rule.
- **Consent fix.** Until Task 17.5 every consent refusal names core's `CONSENT_FIX` (`pnpm --filter
  @gmt/camoufox-worker capture-socs`, `docs/setup.md#capture-your-consent-choice`), shared with WP18.
- **Refusal reasons added:** `consent-not-shown`, `counts-missing`, `counts-unreadable`, `config`; the worker answer
  kind `counts-unreadable` (503) and the `monthly-cap` answer's `used`.
