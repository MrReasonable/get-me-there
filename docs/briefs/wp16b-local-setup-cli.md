---
wp: 16b
title: Local setup (the `gmt` command, native services, imports, CI matrix)
owner: opus
depends_on: [16a]
spec_sections: ["§1", "§4", "§9 item 9", "§9 CI matrix", "§12 Where settings live", "§13 Native local mode", "§13 One app per ledger", "§13 The gmt command", "§15", "§16", "§17 revision 36"]
reviewers: [product-owner, code-architect, test-strategy-reviewer, security-reviewer, devops-reviewer, cost-and-budget-reviewer, persona-flexible-traveller]
mutate: {"@gmt/cli": ["src/plan/**", "src/services/**", "src/setup/appEnv.ts", "src/setup/answers.ts", "src/setup/secrets.ts"]}
pending: {"@gmt/cli": ["src/exec/system.ts", "src/camoufox/**"]}
status: draft
---

# WP16b: Local setup (the `gmt` command, native services, imports, CI matrix)

Written 2026-10-19 against spec revision 36 and plan decisions 1–83, on `feat/local-setup`, and revised after review
rounds 1 to 3 (every finding answered in the review directories' `resolutions.md`). Round 2 split the old WP16
(decision 81): the catch-up, `GET /api/executions/active`, the moved-database marker in the bootstraps and the shared
`core` camoufox pieces are WP16a's, which this package depends on. This package builds the operator's chosen items 1
and 3: a `pnpm gmt setup` wizard that takes a clean Mac or Linux machine to a running, authenticated app, the native
("no-Docker") run mode it installs, the moves from Docker or a checkout database, and `update` with decision 80's rules.
Camoufox, consent and the worker service are WP17's; the status report is WP18's.

**Who it is for** (decision 71): someone technical but new to the project, on a clean macOS or Linux machine, and the
operator on their own Mac (which already has a Docker install with data in the `gmt-data` volume). One operator per
install.

## 1. Goal

`git clone … && corepack enable && pnpm install && pnpm gmt setup`, pressing Enter at every prompt, leaves the app
running as a user service on `127.0.0.1` with generated basic auth, settings in a 0600 `app.env`, a first backup taken
and a daily backup job, and a closing screen that says plainly whether a price source is configured and how to add one;
`gmt start | stop | restart | logs | backup | restore | password | smoke | update | uninstall` run it, on macOS
(launchd) and Linux (systemd `--user`), proven on both by CI.

## 2. Scope

**In**

- `apps/cli` (`@gmt/cli`), the root `gmt` script with `tsx` resolvable from the root, the boundary rule (decision 72).
- The image's lockfile importer: the Dockerfile copies `apps/cli/package.json` in both install stages and filters
  `!@gmt/cli`; `.dockerignore` admits only that manifest. The image's contents and compose are unchanged.
- The `Platform` interface with `darwin` and `linux`; `win32`'s refusal and its dry-run rule (decision 78).
- Plan/apply with no journal (decision 72): `Action`, `memoryExecutor`, `systemExecutor`, `Runner`, service facts.
- `setup`: prerequisites (including the compose checks), the prompt table (§6), answers (interactive, `--answers
  <file>`, secrets from stdin or a named environment variable), generated secrets, `app.env` rendered, parsed back and
  validated, directories, the app service, the first backup and the daily job, the closing screen, `--dry-run`,
  `--reconfigure <group>`, `--import-docker`, `--import-db <path>`, `--ignore-docker`.
- `start`, `stop`, `restart`, `logs`, `backup`, `restore <file>`, `password`, `smoke`, `update` (decision 80) and
  `uninstall`.
- A local `status`: service state, settings files' presence and modes, units whose Node binary or checkout is gone, a
  compose `app` container beside the native one, a detached checkout, and the worker's refusal (`<workerData>/
  start-refusal.json` read through `startRefusalSchema` and printed through `START_REFUSAL_TEXT` as "refused, not
  retrying: <summary>"); the refusal helper `apps/cli/src/worker/refusal.ts`, which also plans the macOS boot-out of a
  refused worker agent and which WP17's `start` and `update` call. This package is the only later editor of
  `commands/status.ts`; WP18 wires the HTTP report beside these local facts and does not re-own the file; WP17 does
  not edit it.
- CI: the `test` matrix with Windows' listed known failures (`scripts/windows-known-failures.mjs` over vitest's JSON
  results), `install-e2e`, the extended `scripts/workflows.test.mjs`, `@gmt/cli` in the mutation workflow and the root
  `mutate` script, covered by WP16a's mutation-glob check (decision 77).
- Docs: `docs/setup.md` section 0 "Quick start (macOS and Linux)", notes on each later section saying which path it
  applies to, a native restore subsection, the backups-on-the-same-disk sentence, the `newsyslog` line, remote access;
  `README.md` points to section 0. The Docker Desktop companion stays in-repo: root `Start.command` (executable;
  Finder-safe `PATH`; `docker compose config --quiet` then `up -d --build --wait` for `app` only) and
  `docs/local-quickstart.md` (points at section 0 for native, then the four Docker steps; no operator-private dates or
  caps). Section 0 links to that guide for the container path on a Mac.

**Out**

- WP16a's pieces (catch-up, the active-run route, the bootstrap marker check, the `core` camoufox pieces).
- The Camoufox install, the worker service, consent, the browser-provider prompt, the Camoufox step of `update` and the
  Linux library check: WP17. The prompt table lists the browser row as WP17's, and `setup` omits it until WP17 lands.
- `GET /api/status`, the Status view, the consent email: WP18.
- Windows setup (decision 78), settings editing in the UI, a packaged app, a LaunchDaemon for an unattended Mac.

## 3. Spec sections and plan decisions

§1; §4 (the `cli` row); §9 item 9 and the CI matrix; §12 "Where settings live" (the app half); §13 "Native local mode",
"One app per ledger" and "The `gmt` command"; §15's two rows; decisions 71, 72, 77, 78, 80.

## 4. Interfaces consumed

- `core`'s config schema, applied to the result of `util.parseEnv` on the rendered `app.env` text;
  `activeExecutionResponseSchema`, `smokePlanResponseSchema`, `CAMOUFOX_BUILDS`, `FLAGS`, `flagsFor`, `workerDataDir`,
  `startRefusalSchema`, `START_REFUSAL_TEXT`, `effectiveSharedSettings` (WP16a).
- `scripts/backup.mjs` as a child process: `--db <path>` (or `DATABASE_PATH` from the env file), `--dir <dir>`,
  `--keep <n>`; it names the file itself and prints `{ "ok": true, "file": "<path>" }`; any other argument exits 64; its
  default keep is `BACKUPS_KEPT` (5).
- `GET /api/health` for `waitHealthy`; `GET /api/executions/active` for `update` and `--import-docker`; `GET
  /api/tools/smoke/plan` (WP16a) and `POST /api/tools/smoke` for `gmt smoke`.

## 5. Interfaces produced (the single statement; decision 72 points here, WP17 and WP18 code against it)

```ts
// apps/cli/src/platform/types.ts
export type Os = 'darwin' | 'linux' | 'win32';
export type Arch = 'arm64' | 'x64';
export interface Paths {
  config: string;        // ~/.config/get-me-there (XDG_CONFIG_HOME honoured on linux when absolute)
  data: string;          // ~/.local/share/get-me-there (XDG_DATA_HOME likewise)
  state: string;         // ~/.local/state/get-me-there (XDG_STATE_HOME likewise)
  workerData: string;    // always workerDataDir(home) from core (XDG ignored; spec §12)
  camoufoxRoot: string;  // always ~/.local/share/get-me-there/camoufox (XDG ignored)
  logs: string | null;   // ~/Library/Logs/get-me-there on darwin; null on linux (the journal)
  serviceDir: string;    // ~/Library/LaunchAgents | ~/.config/systemd/user
}
export interface ServiceSpec {
  name: 'app' | 'backup' | 'camoufox-worker';
  argv: readonly string[];               // argv[0] is the recorded process.execPath; never a shell string
  workingDirectory: string;
  environment: Readonly<{ PATH: string; HOME: string }>; // the whole environment
  restart: 'on-failure' | 'never';
  preventRestartExitStatus: number | null; // 78 for the worker (systemd)
  throttleSeconds: number;                 // launchd ThrottleInterval: 60, or 600 for the worker
  calendar: { hour: number; minute: number } | null; // jobs only
}
export interface RenderedService { path: string; contents: string; unitName: string }
export interface ServiceFacts { onDisk: string | null; loaded: boolean; state: ServiceState }
export type ServiceState = 'running' | 'stopped' | 'failed' | 'not-installed';
export interface ServiceManager {
  render(spec: ServiceSpec, paths: Paths): RenderedService[];  // one plist, or a .service (+ .timer)
  facts(r: readonly RenderedService[], run: Runner): Promise<ReadonlyMap<string, ServiceFacts>>; // the only async read
  install(r: readonly RenderedService[], facts: ReadonlyMap<string, ServiceFacts>): Action[]; // [] when unchanged
  start(unitName: string, facts: ServiceFacts): Action[];
  stop(unitName: string, facts: ServiceFacts): Action[];
  restart(unitName: string, facts: ServiceFacts): Action[];
  remove(r: readonly RenderedService[], facts: ReadonlyMap<string, ServiceFacts>): Action[];
}
export interface Platform {
  os: Os;
  arch: Arch;
  uid: number;           // for launchctl's gui/<uid> domain
  paths: Paths;
  hasDisplay: boolean;
  writeSecretFile(path: string, contents: string): Action;
  serviceManager: ServiceManager;
}

// apps/cli/src/plan/action.ts
export type Action =
  | { kind: 'mkdir'; path: string; mode: 0o700 | 0o755 }
  | { kind: 'writeFile'; path: string; contents: string; mode: 0o600 | 0o644; secret: boolean }
  | { kind: 'download'; url: string; to: string; sha256: string; bytes: number }
  | { kind: 'unpack'; archive: string; sha256: string; to: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'copy'; from: string; to: string; mode: 0o600 }
  | { kind: 'remove'; path: string; recursive: boolean }
  | { kind: 'run'; argv: readonly string[]; cwd: string; describe: string; secretStdin: boolean; stdin?: string }
  | { kind: 'waitHealthy'; url: string; timeoutSeconds: number };
export interface Plan { command: string; actions: readonly Action[]; notes: readonly string[] }
export interface Executor { run(a: Action): Promise<void> }
export interface ApplyResult { done: readonly Action[]; failed: { action: Action; error: string } | null; notRun: readonly Action[] }
export function apply(plan: Plan, ex: Executor): Promise<ApplyResult>; // stops at the first failure
export function describePlan(plan: Plan): string;  // secret files as "<path> (0600, n lines, values hidden)"

// apps/cli/src/exec/runner.ts — the one execFile wrapper, used by systemExecutor and every read
export type Runner = (argv: readonly string[], opts: { cwd: string; stdin?: string; timeoutMs: number; env?: Readonly<Record<string, string>> })
  => Promise<{ code: number; stdout: string; stderr: string }>;

// apps/cli/src/ask.ts
export interface Ask {
  text(q: string, def: string | null): Promise<string>;
  secret(q: string): Promise<string>;   // raw mode on a TTY; never echoed, never logged
  confirm(q: string, def: boolean): Promise<boolean>;
  typed(q: string, word: string): Promise<boolean>; // e.g. 'yes', 'purge'
}

// apps/cli/src/worker/refusal.ts — the worker's refusal file, read once; WP17's start and update call it
export function readStartRefusal(paths: Paths): Promise<StartRefusal | 'none' | 'unreadable'>; // via startRefusalSchema
export function refusalLine(r: StartRefusal): string; // "refused, not retrying: <START_REFUSAL_TEXT summary>"
export function bootOutRefused(platform: Platform, facts: ReadonlyMap<string, ServiceFacts>,
  r: StartRefusal | 'none' | 'unreadable'): Action[]; // darwin, worker agent loaded and a refusal present: its bootout; else []
```

A `run` action's `describe` is what `describePlan` and every error show; its argv never holds a secret (secrets reach a
child only on stdin, `secretStdin: true`), and a test enforces it. `stdin` (added in WP16b, optional so code written
to the first statement still compiles) is the child's standard input: a secret with `secretStdin: true`, or a plain
input such as the moved marker's text with `secretStdin: false`; `describePlan` and errors never show it either way.

## 6. The wizard's prompts (pinned by a docs test against section 0 of `docs/setup.md`)

| # | Question | Default (Enter) | Skip | One-line help |
|---|---|---|---|---|
| 1 | Port | 3000, or the next free one | — | "The app listens on this machine only (127.0.0.1)." |
| 2 | Time zone for schedules | the machine's (`Intl.DateTimeFormat().resolvedOptions().timeZone`), checked by `core` | — | "Scheduled searches fire in this zone." |
| 3 | Market (`POINT_OF_SALE`) | `GB` | — | "Prices stay in pounds in this build." |
| 4 | Travelpayouts token | skip | Enter | "Free, cached prices from Aviasales users' searches; constraints are not checked. Needs a free Travelpayouts account: if you have none, register at https://www.travelpayouts.com/, then open the API token page (https://support.travelpayouts.com/hc/en-us/articles/203956083)." |
| 5 | SearchApi | off | Enter | "`trial`: a one-off allowance for a smoke test and spikes, never run on a schedule. `40usd`: about £32 a month, prices scraped from Google Flights by SearchApi." Key (hidden) and billing day follow only if chosen; for `trial` without an imported database, "Credits already used (100 minus the dashboard's remaining free searches)", default 0, written as `SEARCHAPI_TRIAL_USED`; never asked for `40usd`. |
| 6 | Email alerts | skip | Enter | "Send alerts and notices by email." Host, port, TLS, user, password (hidden), to, from follow only if chosen; the test email is offered once the app is up. |
| 7 | Keep running when nobody is logged in (Linux) | no | Enter | runs `loginctl enable-linger` without sudo, else prints the sudo line |
| 8 | Browser provider | — | — | WP17's row: shown only where its flags are set, after the §2 costs summary |
| 9 | Browser provider after an interruption (asked only when row 8 is yes, and by `--reconfigure browser`) | no | Enter | "If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours? [no]" No writes `CAMOUFOX_BROWSER_WINDOW=scheduled`, yes writes `any` (decision 83); catch-ups never load browser pages either way. Answers field `browser.window: 'scheduled' \| 'any'`. |

When the answers leave no price source and the terminal is interactive (a TTY, not `--non-interactive`), the wizard
asks once, before it applies the plan: "Paste a token now? (Enter to finish without one)" (hidden input; a pasted
token is written as `TRAVELPAYOUTS_TOKEN` as if row 4 had been answered).

Then the closing screen. With no price source configured, it says so first: "No price source is set up yet, so searches
will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at
https://www.travelpayouts.com/, then open the API token page
(https://support.travelpayouts.com/hc/en-us/articles/203956083) and run `pnpm gmt setup --reconfigure
travelpayouts`." Then: URL, user name (`operator`), "the password is in
`~/.config/get-me-there/app.env`; show it with `pnpm gmt password` (if scrollback or a shared screen may have kept it,
`pnpm gmt setup --reconfigure password` replaces it)", an offer to open the browser, remote access in one line (an SSH
tunnel `ssh -L 3000:127.0.0.1:3000 <host>`, or `docs/setup.md` section 3; the service speaks plain HTTP), "scheduled
searches run while this machine is awake; a missed one is caught up once when it wakes, without the browser provider",
and, with a price source, "next: Definitions → Coverage check".

`--reconfigure <group>` (`port`, `timezone`, `email`, `travelpayouts`, `searchapi`, `browser`, `password`) asks only that
group's rows, replaces only its lines, and plans a restart. Lines under names the wizard does not own are kept values.

## 7. Library and tool notes

Verify each on the day of dispatch and record the source and date here.

- **Node `--env-file` and `util.parseEnv`** (nodejs.org/api/cli.html, util.html#utilparseenvcontent): `parseEnv` is the
  parser behind `--env-file`; the worker's `run.ts` already uses it on Node 22.18. Values in the file do not override
  variables already in the environment, so services start with `PATH` and `HOME` only. Double-quoted values expand
  escapes; the wizard refuses `"`, `\`, CR and LF in operator values and uses `[A-Za-z0-9_-]` for generated ones.
- **launchd** (`man launchd.plist`, `man launchctl`, macOS 15): `bootstrap gui/<uid> <plist>`, `bootout
  gui/<uid>/<label>` (when loaded), `kickstart -k`, `print gui/<uid>/<label>`; keys `Label`, `ProgramArguments`,
  `WorkingDirectory`, `EnvironmentVariables` (`PATH`, `HOME`), `KeepAlive` `{ SuccessfulExit: false }` (a boolean: it
  cannot exclude one exit code), `ThrottleInterval`, `ExitTimeOut` 30 (the default 20 s would kill the app before its
  25 s shutdown), stdout and stderr paths, `StartCalendarInterval`.
- **systemd `--user`** (systemd.service(5), systemd.timer(5), systemd.exec(5), loginctl(1)): units in
  `~/.config/systemd/user/`; `daemon-reload`, `enable --now`, `restart`, `stop`, `disable`, `reset-failed`,
  `is-active`, `show-environment` (the probe; `is-system-running` exits non-zero for `degraded` too); `Restart=on-failure`,
  `RestartSec=60`, `RestartPreventExitStatus=`, `TimeoutStopSec=30`, `KillSignal=SIGTERM`, `Environment=` for `PATH`
  and `HOME` only, `ExecStart` quoting (and `%%` for a literal `%`), timers with `OnCalendar=*-*-* 03:30:00` and
  `Persistent=true`, `systemd-analyze --user verify`, `loginctl enable-linger`.
- **Docker** (docs.docker.com, compose CLI): `docker compose -p get-me-there ps -a --format json`, `docker volume
  inspect get-me-there_gmt-data`, `docker compose stop app`, `docker compose run --rm --no-deps --entrypoint …`,
  `docker compose cp`.
- **Travelpayouts sign-up** (https://www.travelpayouts.com/, https://support.travelpayouts.com/hc/en-us/articles/203956083):
  on the day of dispatch, record here with the source and date that registration is free, whether a new account's API
  token works straight away or after an approval, and the current sign-up URL; if it differs, the row 4 help and the
  closing text change with it (the docs test pins both).
- **vitest's JSON reporter and `vitest list --json`** (vitest.dev/guide/reporters, vitest.dev/guide/cli): the result
  file's per-test `file`, `fullName` and `status`, and the list output across projects, which
  `scripts/windows-known-failures.mjs` reads.
- **GitHub-hosted runners**: research task 16b.0 below.

## 8. Files

Create: `apps/cli/{package.json, tsconfig.json, tsconfig.test.json, vitest.config.ts, stryker.config.json}`,
`src/main.ts` (the only `process.env` reader), `src/args.ts`, `src/ask.ts`, `src/platform/{types,darwin,linux,win32,
current}.ts`, `src/services/{launchd,systemd}.ts`, `src/plan/{action,apply,describe}.ts`,
`src/exec/{memory,system,runner}.ts`, `src/commands/{setup,start,stop,restart,logs,backup,restore,password,smoke,update,
uninstall,status}.ts`, `src/setup/{prereqs,docker,prompts,answers,secrets,appEnv,importDocker,importDb,closing}.ts`,
`src/worker/refusal.ts`, `test/**`, `ci/answers.e2e.template.json`, `ci/windows-known-failures.txt`,
`scripts/windows-known-failures.mjs` (+ test).

Modify: root `package.json` (`gmt` script, `tsx` devDependency, `mutate`), `pnpm-lock.yaml`, `Dockerfile`,
`.dockerignore`, `scripts/check-boundaries.mjs`, `scripts/workflows.test.mjs`, `vitest.config.ts` (project `cli`),
`.github/workflows/{ci,mutation}.yml`, `docs/setup.md`, `README.md`.

## 9. Tasks

### Task 16b.0: Research (no product code; settled before Tasks 16b.3 and 16b.11)

- [x] A manually dispatched workflow on a scratch branch: on `macos-15`, write a trivial plist, `launchctl bootstrap
  gui/$(id -u)`, `launchctl print`, `bootout`; on `ubuntu-24.04` and `ubuntu-24.04-arm`, `sudo loginctl enable-linger
  runner`, `systemctl --user` with `XDG_RUNTIME_DIR=/run/user/$(id -u)`, a trivial unit started and stopped; check
  whether an Intel macOS runner label is available today. Record each runner's mode (`real` or `lint-only` with the
  reason), the run link and the date in this section; the matrix's literal modes come from this record.
- [x] Run the whole existing suite on `windows-2025` once and write `ci/windows-known-failures.txt` (one `<file
  relative to the repository root> > <full title>` a line, the full title being vitest's `fullName`) and the same list
  into decision 78.
- [x] Verify §7's notes against their sources; record dates.

**Research record (2026-10-24).** Scratch branch `research/wp16b-runners` (one throwaway workflow, no secrets, deleted
after the runs). GitHub refuses `gh workflow run` for a workflow that exists only off the default branch ("workflow …
not found on the default branch"), so the workflow also ran on a `push` to that branch alone, once: run
https://github.com/MrReasonable/get-me-there/actions/runs/40117391189 (2026-10-24).

| Runner | Service manager | Mode | What ran |
|---|---|---|---|
| `macos-15` (arm64, macOS 15.7.9, uid 501) | launchd | `real` | `launchctl print gui/501` ok (a GUI domain exists); `plutil -lint`; `bootstrap gui/501 <plist>`; `print` showed `state = running`; `kickstart -k`; `bootout` |
| `macos-15-intel` (x86_64, macOS 15.7.9) | launchd | `real` | the same, all ok: an Intel macOS label is available today (for WP17's `darwin-x64`) |
| `ubuntu-24.04` (x86_64, uid 1001) | systemd `--user` | `real` | `sudo loginctl enable-linger runner`; `show-environment` ok with `XDG_RUNTIME_DIR=/run/user/1001`; `is-system-running` `running`; `systemd-analyze --user verify` of a `.service` and a `.timer` ok; `daemon-reload`, `enable --now`, `is-active`, `restart`, `stop`, `disable` ok; `/var/log/journal` present |
| `ubuntu-24.04-arm` (aarch64, uid 1001) | systemd `--user` | `real` | the same, all ok |

No runner is `lint-only`. The runners' Node binaries are `/opt/homebrew/Cellar/node@22/…/bin/node` (macOS arm64),
`/usr/local/Cellar/node@22/…/bin/node` (Intel) and `/usr/local/bin/node` (Ubuntu): none is a temporary or shim path.

Windows baseline, `windows-2025`, the same run (`vitest run` from the root over every project): 3,406 tests, 243
failed, and 195 files failed to load before any test ran. 150 of the load failures were one portability fault fixed in
this package: `packages/db`, `packages/providers` and `apps/api` built their alias root with `new URL(…).pathname`,
which reads `/D:/…` on Windows (they now use `fileURLToPath`, as `apps/web` did). The per-test failures were in the
worker (`record`, `session`, `gridPage`, `main`, `run`, `recordings`, `cooldown`, `rules`, `paths`: POSIX modes and
paths), `scripts/` (`check-boundaries`, `ensure-build`, `workflows`, `secret-scan`, `assert-dist-resolution`) and
`apps/web`'s `sourceGuard`. Because the list must match the tree that lands (this package adds tests too), it is
written from a second scratch run of the final tree in Task 16b.11, recorded there.

§7 checks (2026-10-24): `util.parseEnv` on Node 26.12.0 locally (double-quoted values keep `$`, `#`, `'` and backticks
and expand `\n`); the launchd and systemd commands and keys by the run above; `docker compose` v5.5.0's `ps -a
--format json`, `run --rm --no-deps -T --entrypoint`, `cp` and `stop` by their `--help`; vitest 5.0.4's JSON reporter
(`testResults[].name` an absolute path, `assertionResults[].fullName` the ancestor titles and the title joined by a
space, `status`) and `vitest list --json` (an array of `{ name, file, projectName }`, `name` joined by ` > `) by running
both. **Travelpayouts sign-up not verified:** the work package's rule allows no vendor call, so its page was not
opened; the row 4 help and the closing text keep the URLs above until the operator confirms them.

### Task 16b.1: Package, root script, image manifest, boundary rule, `Action` and `apply` (first failing test)

- [ ] **Failing tests.**
  - `pnpm gmt --help` from the repository root exits 0 (a child-process test), proving `tsx` resolves there.
  - `apply` runs actions in order on `memoryExecutor`; on the third throwing, it stops, `done` holds 1–2, `failed` 3,
    `notRun` the rest; a re-run of the planner after actions 1–2 took effect plans only 3 onwards.
  - `describePlan` never prints a `secret: true` file's contents (property test over random secrets) and never a
    `secretStdin` input.
  - The boundary script fails fixtures where `apps/cli` imports `@gmt/db`, `@gmt/camoufox-worker`, `camoufox-js` or
    `playwright-core`, and where a file other than `src/main.ts` reads `process.env`.
  - `scripts/workflows.test.mjs`: the image builds with `apps/cli/package.json` copied in both install stages and
    filtered out.
- [ ] **Implement; `pnpm --filter @gmt/cli test`; commit `wp16b: cli package, plan and apply`.**

### Task 16b.2: `Platform` for darwin and linux, and win32's refusal

- [ ] **Failing tests:** `currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/a' } })`
  gives §5's paths and `uid`; linux honours absolute `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` for `config`,
  `data`, `state`, ignores relative ones, and never for `workerData` (equal to `core`'s `workerDataDir(home)`) or
  `camoufoxRoot` (a test with `XDG_DATA_HOME` set); `hasDisplay` on linux is true iff `DISPLAY` or `WAYLAND_DISPLAY` is
  non-empty, on darwin true; `writeSecretFile` yields `writeFile` 0o600, `secret: true`. On win32, `setup --dry-run`
  prints "Windows setup is not built yet; run the app with Docker (docs/setup.md)" and exits 0 with no plan, and
  `setup` exits 78 with the same text.
- [ ] **Implement; commit.**

### Task 16b.3: The service renderers, facts and install semantics

- [ ] **Failing tests:**
  - The `app` spec: the launchd plist snapshot (label `local.get-me-there.app`, `ProgramArguments` `[<execPath>,
    --env-file=<abs app.env>, <checkout>/apps/api/dist/bootstrap/start.js]`, `EnvironmentVariables` exactly `PATH` and
    `HOME`, `KeepAlive.SuccessfulExit` false, `ThrottleInterval` 60, `ExitTimeOut` 30, logs under `paths.logs`); the
    systemd unit snapshot (`ExecStart` the same argv, `Environment=` `PATH` and `HOME` only, `Restart=on-failure`,
    `RestartSec=60`, `TimeoutStopSec=30`, `KillSignal=SIGTERM`, `WantedBy=default.target`); the `backup` spec as a
    calendar agent and as a `.service` plus `.timer` (`OnCalendar=*-*-* 03:30:00`, `Persistent=true`) whose argv is
    `[<execPath>, --env-file=<abs app.env>, <checkout>/scripts/backup.mjs, --dir, <data>/backups/daily, --keep, 14]`.
  - Property tests: the plist parsed back gives `ProgramArguments` equal to the argv; `ExecStart` tokenised back equals
    the argv for paths with spaces, quotes, `%` and `$`.
  - The backup argv parses under `scripts/backup.mjs`'s own argument parser (imported in the test).
  - Every rendered service's environment is exactly `{ PATH, HOME }`; a sentinel secret in `app.env` appears in no
    rendered file; no rendered file contains `pnpm` or `corepack`.
  - `facts` reads `launchctl print gui/<uid>/<label>` or `systemctl --user is-active` once through `Runner`; `install`
    is pure over those facts: an unchanged file plans nothing; a changed plist plans `launchctl bootout
    gui/<uid>/<label>` only when `loaded`, the `writeFile`, then `launchctl bootstrap gui/<uid> <path>`; a changed unit
    plans the `writeFile`, `systemctl --user daemon-reload`, then `enable --now` (new) or `restart` (existing).
    `remove` plans stop, disable, delete, `daemon-reload` and `reset-failed` on Linux.
  - `argv[0]` comes from the recorded `process.execPath`; a path under a temporary directory or a known shim directory
    (`.volta/bin`, `.asdf/shims`, `fnm_multishells`) is refused with the message naming a stable Node path.
- [ ] **Implement; commit.**

### Task 16b.4: Prerequisites and the Docker checks

- [ ] **Failing tests** (facts injected; every check runs before any action):
  - Node 22.17 fails with the OS's fix (`brew install node@22`; on Linux the distribution package or NodeSource's
    package, never a curl-pipe).
  - No `pnpm` with corepack present gives `corepack enable`, and where Node's directory is not writable
    `corepack enable --install-directory ~/.local/bin` with the PATH note.
  - The chosen port busy offers the next free one.
  - Docker: a compose project `get-me-there` that exists, running or stopped (`docker compose -p get-me-there ps -a`), or
    an existing `get-me-there_gmt-data` volume refuses native setup with "an earlier Docker install exists: use
    --import-docker to move its data, or --ignore-docker to start fresh (the Docker database is then marked moved)"; the
    `docker` command present but the daemon not answering refuses with "start Docker so setup can check for an existing
    compose app, or pass --ignore-docker"; no `docker` command passes.
  - macOS: `launchctl print gui/<uid>` failing gives "no GUI session (for example over SSH): log in at the Mac, or turn
    on automatic login for a Mac that must run unattended".
  - Linux: `systemctl --user show-environment` failing with no user bus gives "log in through a proper session, or set
    XDG_RUNTIME_DIR=/run/user/<uid>"; systemd absent gives "this setup needs systemd; use the container path"; a
    `degraded` user manager passes.
  - Linux with `/var/log/journal` absent prints the persistence note (not a failure).
- [ ] **Implement; commit.**

### Task 16b.5: Answers and prompts

- [ ] **Failing tests:**
  - The prompt table of §6, in order, with its defaults: Enter through every prompt gives answers for a running app with
    no price source, no email, no linger; a docs test pins section 0's prompt list to the CLI's, row 4's help and the
    closing text's two Travelpayouts URLs included.
  - With no price source on a TTY, "Paste a token now? (Enter to finish without one)" is asked exactly once, before any
    action is applied; Enter leaves the answers unchanged; a pasted token gives the same answers as answering row 4;
    with a price source, `--non-interactive`, `--answers` or no TTY it is never asked.
  - SearchApi `trial` without an imported database asks the credits already used (default 0) and writes
    `SEARCHAPI_TRIAL_USED`; with an imported database or with `40usd` it never asks; `--reconfigure searchapi` includes
    it; the answers schema has `searchApi.trialUsed`.
  - `--answers <file>`: a strict zod schema (unknown keys refused, so no `ALLOW_FIXTURE_PROVIDER`, no `DATABASE_PATH`
    override, no `.fixture.db`); a file holding any secret field and readable by group or others is refused naming
    `chmod 600`; a secret may instead be `{ "fromEnv": "NAME" }` or `{ "fromStdin": true }`.
  - An invalid secret's value never appears in any error, refusal or plan output (a sentinel in each secret field, each
    made invalid in turn).
  - No `fetch` is called during setup (global `fetch` stubbed to fail the test).
  - `linger: enable` plans `loginctl enable-linger <os.userInfo().username>` without sudo; on refusal the output is the
    exact `sudo loginctl enable-linger <user>` line and setup continues; `--non-interactive` never prompts for sudo.
- [ ] **Implement; commit.**

### Task 16b.6: `setup` (the plan), the closing screen and `password`

- [ ] **Failing tests:**
  - Clean machine: the plan makes `config`, `data`, `data/backups`, `data/backups/daily`, `data/backups/update`,
    `state` (0700) and, on darwin, `paths.logs` (0700); writes `app.env` (0600, `secret`) with `NODE_ENV=production`,
    `DATABASE_PATH`, `BIND_ADDRESS=127.0.0.1`, `PORT`, `SCHEDULER_TIMEZONE`, `POINT_OF_SALE`,
    `APP_BASIC_AUTH_USER=operator`, a generated `APP_BASIC_AUTH_PASS` (32 base64url characters from
    `crypto.randomBytes(24)`) and the chosen vendor and email lines; runs `pnpm install --frozen-lockfile` and `pnpm
    build`; installs and starts the app and backup services; waits for health up to 240 s; runs the backup service once
    so the first daily backup exists; when that backup fails, setup still finishes, says so on the closing screen with
    `pnpm gmt backup` as the fix, and (WP18) the `backups` check carries its no-backup note.
  - `app.env` round trip: the rendered text parsed with `util.parseEnv` equals the intended record (hostile operator
    values with `$`, `#`, `'`, backtick and spaces round-trip; `"`, `\`, CR, LF are refused), and the parsed record
    passes `core`'s config schema; a schema failure refuses naming the field, never its value, with no actions.
  - **The first failing test (§16):** a second `setup` over an `app.env` whose `PORT` differs from the plan's reports
    the difference and plans no `writeFile` for it; `--reconfigure port` replaces only that line and plans a restart.
  - Each `--reconfigure` group touches only its lines; lines under names the wizard does not own are kept;
    `--reconfigure browser` refuses while `GET /api/executions/active` reports a run, naming it (`--force` first says
    that the app restart interrupts the run and that the new value applies when it resumes, decision 83), then
    asks row 9's question with the current value as its default, writes only
    `CAMOUFOX_BROWSER_WINDOW` for that answer (exactly `scheduled` or `any`, checked by `core`'s schema in the
    `app.env` round trip), and plans an app restart (not a worker restart: the worker does not read it);
    `--reconfigure password` generates a new password and restarts the app.
  - Re-run on a fully set-up machine plans nothing but `waitHealthy`.
  - `--dry-run` prints the plan with the literal `launchctl`/`systemctl` commands and applies nothing.
  - The closing screen: with no price source, its first line is the "No price source is set up yet" text of §6 with
    the Travelpayouts pointer; it always holds the URL, `operator`, the `app.env` path, `pnpm gmt password` and the
    replace hint, and no password.
  - `password` reads `app.env` with `parseEnv` and prints the password to a TTY only; with stdout not a TTY it refuses.
  - Sentinel test over a full run with `memoryExecutor` and with `systemExecutor` in a temporary directory: the password,
    every vendor key and the SMTP password appear in no stdout, stderr, thrown error, plan description, rendered service
    file or log line (raw and base64url).
- [ ] **Implement; commit.**

### Task 16b.7: `--import-docker`, `--import-db` and `--ignore-docker`

- [ ] **Failing tests:**
  - `--import-docker` plan, in order: read the compose `.env` with `parseEnv`; call the container app's `GET
    /api/executions/active` on its published port with that file's basic auth (stdin to the child, never argv); refuse
    while a run is active (naming it and its estimated finish) unless `--wait`; `docker compose stop app`; `docker
    compose run --rm --no-deps --entrypoint node app scripts/backup.mjs --dir /data/backups`; parse the printed `file`;
    `docker compose cp app:<file> <data>/`; set it 0600; restore it as the native database (no `-wal`/`-shm`, rename
    into place) and run `PRAGMA integrity_check`; only then write `/data/MOVED-TO-NATIVE` through `docker compose run
    --rm -T --no-deps --entrypoint sh app -c 'cat > /data/MOVED-TO-NATIVE'`, its content `core`'s
    `movedMarkerText(now)` (the move's instant, UTC to the millisecond, on the first line) passed on stdin, never
    formatted by the shell (no `date`, no `touch`). A test asserts no backup action precedes the stop and no marker
    action precedes the integrity check; a failed restore or check plans no marker.
  - It offers `docker compose down` (no `-v`; default yes) and says why ("a second app on the old database would keep
    its own ledger, so caps would count twice; with the marker it would exit and restart in a loop until then").
  - It offers to carry `TRAVELPAYOUTS_TOKEN`, the `SEARCHAPI_*`, `SMTP_*`, `ALERT_EMAIL_*`, `SCHEDULER_TIMEZONE` and
    `POINT_OF_SALE` lines across, each group confirmed; `ALLOWED_HOSTS` and `APP_BASE_URL` are shown, not copied.
  - `--import-db <path>`: the path's app is not running (its lock is free), backup with `scripts/backup.mjs --db <path>
    --dir <data>/backups`, restore and check natively, then write `MOVED-TO-NATIVE` beside `<path>` (`MOVED_MARKER`), its content
    `movedMarkerText(now)` written by the CLI itself.
  - `--ignore-docker`: writes the marker into the compose volume (container stopped) without importing, as the import
    does (`movedMarkerText(now)` on stdin to `sh -c 'cat > /data/MOVED-TO-NATIVE'`); with the daemon down it refuses.
  - Every marker path is tested end to end on the text it writes: `parseMovedMarker` reads back the planned instant
    from what the import, `--import-db` and `--ignore-docker` each write (the docker steps' stand-in captures stdin).
  - A native database already present: every import refuses unless `--replace-database`, which backs the native one up
    first.
  - Real data (`systemExecutor`, temporary directory, a stand-in for the docker steps): a SQLite source in WAL mode with
    100 executions, some only in its `-wal`, backed up by `scripts/backup.mjs`, restored, reopened, 100 rows counted, and
    `PRAGMA integrity_check` ok. Interruption is injected by a wrapper executor that throws before and after each action,
    plus one case where the copy action throws after writing a partial temporary file: in every case the native database
    is absent, the old one or the new one (opened, integrity-checked, rows counted), never partial, with no stray
    `-wal`/`-shm` beside it, and a `--replace-database` run always leaves the pre-replace backup.
- [ ] **Implement; commit.**

### Task 16b.8: `start`, `stop`, `restart`, `logs`, `backup`, `restore`, `smoke`, local `status`

- [ ] **Failing tests:**
  - Each maps to the service manager's actions for every installed service (the worker's once WP17 adds it).
  - `logs` runs `tail -n 200 -F <files>` on darwin and `journalctl --user -u get-me-there-app -n 200 -f` on linux as
    argv arrays, and prints the group-membership hint when the journal shows nothing.
  - `backup` runs the backup service once (`launchctl kickstart gui/<uid>/<label>`, `systemctl --user start
    get-me-there-backup`).
  - `restore <file>` requires the app stopped, refuses a source failing `PRAGMA integrity_check` before moving anything,
    removes `-wal` and `-shm`, keeps the current file as `<name>.before-restore`, copies the backup into place 0600, and
    prints the vendor-dashboard sentence and, on a detached checkout, `git switch main` (real SQLite test as in Task
    16b.7).
  - `smoke` reads `GET /api/tools/smoke/plan` and prints, before anything is posted, the route's own worst case per
    provider ("SearchApi: up to 4 calls (calendar 1, itinerary 3; trial: N left)", "Travelpayouts: up to F free calls",
    "browser provider: 1 page, up to S scrolls" in grid mode, "1 page" in list mode), then asks for a typed `yes`;
    `--yes` skips the question; with the trial credits left fewer than the SearchApi worst case it refuses before
    posting, naming both numbers; nothing is posted before the statement is printed; a test per provider combination
    asserts the printed figures equal the plan route's (and so `smokeWorstCase`); its `--help` line says "spends real
    calls: up to 4 SearchApi credits and one browser page with today's settings", and a test pins those figures to
    `smokeWorstCase` at the default settings; then it posts `POST /api/tools/smoke` with basic auth from `app.env`
    (never argv) and the mutating-route headers. A test asserts setup, update, status and the e2e fixture never call
    it.
  - Local `status`: each service's state, each settings file's presence and mode (a group- or world-readable file is a
    `fail` naming `chmod 600 <path>`), a unit whose `argv[0]` or checkout path is gone (`fail`, fix `pnpm gmt setup`), on
    macOS a log directory over 100 MB (`warn`, with the `newsyslog` line), a running compose `app` container beside the
    native service (`warn`, fix `docker compose down`), a detached checkout (`warn`, fix `git switch main`), and the
    worker's refusal: with `<workerData>/start-refusal.json` present it prints `refusalLine` (each
    `START_REFUSAL_REASONS` value through `START_REFUSAL_TEXT`, with its fix command), an unreadable file prints
    "refusal file unreadable" and nothing from it (a hostile `fix` string and an unknown reason in fixtures), and on
    darwin with the worker agent loaded it applies `bootOutRefused`'s bootout (a fixture with the agent installed; with
    no worker agent, as before WP17, it plans nothing).
- [ ] **Implement; commit.**

### Task 16b.9: `update` and `uninstall`

- [ ] **Failing tests:**
  - `update` refuses with local changes (`git status --porcelain`) or a branch other than `main`; runs `git fetch` and a
    fast-forward check (`git merge-base --is-ancestor HEAD origin/main`) before anything stops, so a network failure
    leaves the app running.
  - With `GET /api/executions/active` returning a run, it refuses naming the definition, start and estimated finish (or
    "unknown"); a 401, a timeout or no answer while the app service is active also refuses; with the service inactive it
    proceeds; `--wait` polls every 60 s (fake clock) until none; `--force` prints decision 80's statement (the 30 s stop,
    the abandoned page or call, the `AUTO_RESUME` on and off variants) before its first action.
  - Otherwise the plan is, in order: record `git rev-parse HEAD`, stop the app and the worker, back up into
    `backups/update` (`--keep 5`, named), `git merge --ff-only origin/main`, `pnpm install --frozen-lockfile`, `pnpm
    build`, [WP17's Camoufox step], re-render the units (a difference is shown and applied), start, `waitHealthy` 240 s,
    [WP17's old-bundle removal], status. Tests assert no backup precedes the stop and no merge, install or build precedes
    the backup.
  - A failure at the merge, install, build, start or health wait prints the recorded commit, the backup file, each native
    restore step of spec §13 and the shorter path for an unmigrated database, and plans nothing further (one test per
    failing step).
  - `uninstall` plans stop and remove for every unit, timer and agent (`daemon-reload` and `reset-failed` on Linux),
    removes the macOS log files, keeps and prints `config`, `data`, `state`, and offers to disable linger when setup
    enabled it (the recorded answer). The removed and kept path lists are exported for the e2e job.
  - `--purge` lists the three directories, requires the typed word `purge`, refuses with `--non-interactive`, and refuses
    a directory that is a symlink, equals `$HOME` or `/`, or whose basename is not `get-me-there`; it deletes with
    `fs.rm` on the real path.
- [ ] **Implement; commit.**

### Task 16b.10: `systemExecutor`

- [ ] **Failing tests** (temporary directory): `writeFile` writes a sibling temporary file with the mode and renames
  (mode correct under umask 022); `mkdir` applies its mode; `copy` writes through a temporary file and renames; `run`
  uses `execFile` with the argv, never a shell, and passes `secretStdin` input on stdin only; `download` streams while
  hashing and deletes the partial file on a mismatch (a loopback HTTP server).
- [ ] **Implement; commit.**

### Task 16b.11: The workflow guard and the CI matrix

- [ ] `scripts/workflows.test.mjs` gains a describe block that parses each workflow's YAML and fails on: the `secrets`
  context in any form (`secrets.X`, `secrets[...]`, `toJSON(secrets)`, `secrets: inherit`); `github.token` or
  `GITHUB_TOKEN` in `install-e2e` or `camoufox-install`; `pull_request_target`; `workflow_run`; `runs-on` naming
  `self-hosted`; a missing top-level `permissions: contents: read`; any `uses:` not pinned by a 40-character SHA; any URL
  in the workflow YAML or the `ci/*.json` files its steps name whose host is off its allowlist (`registry.npmjs.org`,
  `127.0.0.1` and `localhost` for every job; `github.com`, `objects.githubusercontent.com` and
  `release-assets.githubusercontent.com` for `install-e2e` and `camoufox-install` only); an `E2E-MODE` that is not a
  literal `real` or `lint-only` in the matrix; a matrix with no `real` entry; and a `lint-only` entry whose runner Task
  16b.0's record does not name. One failing fixture per ban, including a release host in another job and a computed
  `E2E-MODE`.
- [ ] `scripts/windows-known-failures.mjs`: `check <results.json>` reads vitest's JSON results and compares each test,
  keyed `<relative file> > <fullName>`, with `ci/windows-known-failures.txt`; `guard` reads `vitest list --json` across
  every project. Tests in `scripts/` with fake results and list files: an unlisted failure exits 1; a listed failure
  exits 0 and prints its key; a listed test that passes exits 1; a line naming no test fails the guard; a duplicate
  line is refused; a line matching two tests is refused; an empty list with no failure exits 0.
- [ ] `ci.yml`: `test` as a matrix over the four runners (`shell: bash` where steps use bash); on Windows the vitest
  run writes its JSON results (`--reporter=json --outputFile`, beside the default reporter) without failing the step on
  test failures, and the next step runs `node scripts/windows-known-failures.mjs guard` and `check <results>`, whose
  exit code is the leg's; POSIX-only tests skip with visible titles; there is no `continue-on-error`. `install-e2e`
  on `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15` with each entry's literal mode from Task 16b.0, `timeout-minutes:
  30`, `permissions: contents: read`: build the fixture (a bare repository from the checkout, a clone on a local `main`
  in `$RUNNER_TEMP`), `pnpm gmt setup --non-interactive --answers <generated from the template: PORT 3917, linger
  enable>`, assert installed (plist or unit present, `launchctl print`/`systemctl --user is-active` ok, `curl -fsS
  http://127.0.0.1:3917/api/health`), `pnpm gmt status` exits 0 with `backups` `ok` (newest backup under 36 h old, no
  note) and `price-sources` `warn` (once WP18 lands; until then the local status), push a commit to the bare repository, `pnpm gmt update`, assert the served
  version changed, `pnpm gmt uninstall --non-interactive`, assert the removed list absent and the kept list present,
  echo `E2E-MODE`, upload the service logs on failure. Windows: `pnpm gmt setup --dry-run --answers <generated>` exits
  0. `mutation.yml` and the root `mutate` script gain `@gmt/cli` with `mutation-gate.mjs`; this brief's front-matter
  `pending` scope (`src/plan/**`, `src/services/**`, `src/exec/system.ts`, `src/setup/{appEnv,answers,secrets}.ts`,
  `src/camoufox/**`) moves to its `mutate` field, and WP16a's `scripts/check-mutation-globs.mjs` then checks it against
  `apps/cli/stryker.config.json`.
- [ ] **Commit `wp16b: workflow guard and CI matrix`.**

### Task 16b.12: Docs

- [ ] `docs/setup.md` section 0 "Quick start (macOS and Linux)": the four commands (`corepack enable`, or the
  `--install-directory` form), the prompt table, where files live, the closing screen (including the no-price-source
  case, Travelpayouts' sign-up path and the paste-now question), `pnpm gmt password` and the replace hint, every `gmt`
  command, `gmt smoke`'s spend (its printed worst case, up to 4 SearchApi credits and one browser page with today's
  settings), remote
  access (SSH tunnel; section 3 for Tailscale and TLS; plain HTTP otherwise), "scheduled searches run while the machine
  is awake; a missed one is caught up once, without the browser provider", moving from Docker (`--import-docker`; the
  marker; never start the compose stack again; the marker's removal line) or from a checkout (`--import-db`), "on a
  VPS, use the container path below" with a link to `docs/local-quickstart.md` and `Start.command` for Docker Desktop
  on a Mac, backups (same disk as the database: they protect against a bad update or a
  deletion, not disk loss; copy the folder elsewhere, Time Machine includes it), log rotation (`newsyslog` line on
  macOS; journal persistence on Linux), and a native restore subsection (integrity check, vendor dashboard, `git switch
  main`). Sections 1–13 each gain one line naming the path they apply to; section 13 names `pnpm gmt smoke` for native
  installs.
- [ ] Keep `Start.command` executable in the repository root and `docs/local-quickstart.md` in the operator-doc set:
  the quickstart names section 0 for native, then the Docker steps; a docs test asserts `Start.command` is tracked,
  mode `0755` (or at least owner-executable), contains `docker compose config --quiet` and
  `--wait-timeout 240`, and never `echo`s compose config or `.env` values; `local-quickstart.md` stays free of
  operator-private dates, call caps and routes beyond the worked example. The quickstart's first line, "Until `pnpm gmt
  setup` ships (WP16b), Docker is the working local path", becomes the pointer to section 0 for the native path, and
  `apps/api/test/deploy/docs.test.ts`'s pin of that sentence (the case "local-quickstart copies backups off the volume,
  not a host data/backups/ folder") changes with it: it asserts the quickstart names `pnpm gmt setup` and section 0
  instead of "Until … ships".
- [ ] A docs test parses section 0's fenced commands and runs each through the CLI's argument parser (`--dry-run` or
  `--help`), so a wrong flag or command fails.
- [ ] The wording test passes. `README.md` points at section 0 and at `docs/local-quickstart.md`.

## 10. Pinned review-focus tests

- No secret in any plan output, rendered service file, log line, error or stream (Tasks 16b.1, 16b.3, 16b.5, 16b.6).
- `app.env` round-trips through `parseEnv` and passes `core`'s schema before it is written (Task 16b.6).
- A differing file is reported, never overwritten (Task 16b.6, the first failing test).
- Nothing can spend after an import's backup; no marker before the native copy is checked (Task 16b.7).
- Data-loss paths on a real SQLite database, interrupted mid-copy (Tasks 16b.7, 16b.8).
- `update` stops before it backs up, and backs up before it changes code (Task 16b.9).
- `gmt smoke` states its spend before posting (Task 16b.8).
- No CI job reads a secret or reaches a host off its job's allowlist; at least one e2e runner is real (Task 16b.11).

## 11. Definition of done

- `pnpm --filter @gmt/cli test` at 85% lines and 70% branches; `pnpm --filter @gmt/cli mutate` ≥ 80% on its mutation
  scope.
- `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, `node scripts/check-casts.mjs`, `pnpm test`.
- CI green: the four `test` runners (Windows only within its listed known failures), the three `install-e2e` runners in
  the modes Task 16b.0 recorded with at least one `real`, the docker job (the image builds with the new importer).
- On the operator's Mac: `pnpm gmt setup --import-docker` moves the compose database across with no run active, the
  container then refuses to start, `pnpm gmt status` shows the app running, the web app answers at
  `http://127.0.0.1:3000` with the credentials from `pnpm gmt password`, History shows the imported runs; `pnpm gmt
  uninstall` then `pnpm gmt setup` reaches the same state with the data kept.

## 12. Open questions

None. Task 16b.0 decides only each runner's e2e mode and the Windows known-failing list, not the design.
