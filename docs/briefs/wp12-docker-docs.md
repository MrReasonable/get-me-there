---
wp: 12
title: Docker, compose, env, backup, docs
owner: sonnet
depends_on: [8, 9, 11]
spec_sections: ["§1", "§4 auth", "§5.5", "§7 Migrations, app_lock", "§8.2", "§8.3", "§11 banned words", "§12", "§13", "§14", "§9 item 8"]
reviewers: [code-architect, test-strategy-reviewer, devops-reviewer, security-reviewer, cost-and-budget-reviewer, persona-flexible-traveller]
status: reviewed
---

<!-- Revised 2026-10-17 after review round 1 (3 High, 15 Medium, 16 Low; rulings in plan decision 63), against spec revision 26, plan decisions 1–63 and the code on main at be59ca1 (WP0–WP7, WP4b merged), with the WP8, WP9 and WP11 briefs for what is not on main yet. -->

# WP12: Docker, compose, env, backup, docs

## 1. Goal

Ship the one-container deployment (a non-root, hardened image and compose service with an environment allowlist and basic auth always on, the final `.env.example`), the on-demand backup and backup-check CLIs over the code the bootstraps use, a CI job that drives the shipped compose file through boot, backup, a refused second app, a graceful stop, a hard kill and a restore, and the three operator documents, each held to the code by a test: the preset and cadence tables are generated from the functions the app enforces, the exit codes from the one `EXIT` table, the example from the JSON the web app imports.

## 2. Scope

**In**

- `Dockerfile` (three stages on `node:22-slim` pinned by index digest; pnpm through corepack, verified against the `sha512` in `packageManager`; the fail-closed `better-sqlite3` prebuilt check in every stage; `NODE_ENV=production`, `IN_CONTAINER=1`; `/data` and `/data/backups` owned by `node` before `VOLUME`; no `apt-get`, curl or wget; no `ARG`; only the four scripts the image runs; a liveness `HEALTHCHECK` by node fetch of `/api/health`; `USER node`; `CMD` WP8's `apps/api/dist/bootstrap/start.js`) and `.dockerignore` (secrets, keys, nested npm config, local databases, backups, every recorded vendor response, other checkouts).
- `scripts/assert-sqlite-prebuilt.mjs`, `scripts/assert-dist-resolution.mjs` (image build assertions), `scripts/backup.mjs` (on-demand backup) and `scripts/check-backup.mjs` (integrity check before a restore). The two backup CLIs hold no rule of their own: they load `EXIT`, `BACKUPS_KEPT` and `backupsDirFor` from apps/api's build. Their tests sit beside them in the root Vitest project `scripts` (decision 49), plus a type-checked drift guard in `apps/api/test/deploy/`.
- `docker-compose.yml`: `app` with an explicit environment allowlist built by interpolation (every operator variable of `.env.example` except `ALLOW_UNAUTHENTICATED`, never `NODE_ENV`, `IN_CONTAINER`, `ALLOW_FIXTURE_PROVIDER` or `FIXTURE_COST_MICRO_GBP`, no `env_file`), named volume, loopback port, read-only root with a `/tmp` tmpfs, `cap_drop: [ALL]`, `no-new-privileges`, no `user:` override; `mailpit` under the `dev` profile for the host-side `pnpm dev` only. The Tailscale-only override that turns auth off is documented, not shipped (decision 63).
- `.env.example` made byte-equal to the spec §12 block (revision 26), with a test that keeps it so and that its variables are exactly the ones the config reads (WP4b's `ALL_VARS`).
- `docs/setup.md`, `docs/api-limits.md`, `docs/scheduling.md`, `docs/examples/london-new-york.json` (the worked example, London → New York only).
- The deploy tests in `apps/api/test/deploy/` (type-checked by `apps/api/tsconfig.test.json`, scanned by `pnpm casts`, workspace packages through `vitest.aliases.ts`) and `apps/web/test/example.test.ts` (WP9's constant equals the docs JSON).
- `.github/workflows/ci.yml`: every action pinned by commit SHA, WP0's Dockerfile grep step removed, and a `docker` job.
- Root `package.json`: `packageManager` gains pnpm 12.9.1's `+sha512` hash.

**Out**

- The app bootstrap and its entry (`bootApp`, `main`, `start.ts`), `/api/health` and its detail, auth, Host checks, the read-only lock wait (decision 53), the backup preflight and its boot test (`app.backup.test.ts`, decision 32), graceful shutdown, the web root (`assetPaths()`), `POST /api/tools/record` and its refusal inside a container (decision 62): WP8. WP12 does not modify `apps/api/src/`.
- `backupDatabase` (VACUUM INTO, integrity check, refuse-existing, 0700/0600 modes, world-writable refusal, prune) and its tests: WP3 (on main). The preflight helpers `backupsDirFor`, `BACKUPS_KEPT`, `dataDirRefusal`, the tool bootstrap, `seededPorts` and the `EXIT` table: WP4b (on main).
- The config schema, `PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`, `microGbpToPence`: WP0 (on main). `ALERT_EMAIL_MAX_PER_HOUR`, the one-mailbox and `SMTP_TLS=none` rules and the "email not configured" suppression: WP11. WP12 renders and documents them; it changes none.
- `apps/web/src/example.ts` (`EXAMPLE_DEFINITION`, a JSON import of the docs file) and the boundary script's place-name and suppression checks: WP9 (decisions 36, 46, 49).
- The live smoke test, its route, its CLI, its documentation in `docs/setup.md` and its exit codes 2 and 3 in the setup table: WP13 (decision 63). `pnpm record:fixtures`: WP4b (on main); WP12 documents it.
- The guard that makes the recorded-tree tests skip visibly when recordings are absent: WP13 (decision 61).
- The secret scan, `pnpm boundaries`, `pnpm casts` and their CI steps: WP0/WP7/WP9 (on main or merged before WP12). WP12 adds no rule to any of them; its new files pass them.

## 3. Spec sections and plan decisions

- **§1.** The docs carry London → New York (LHR, LGW → JFK, EWR) as importable JSON and name no other airport or metro code (a test scans every operator doc against the airports dataset); the £0 path is a three-line `.env`.
- **§4 (auth), §12; decision 63.** `docs/setup.md` makes auth the first step with a random password and a private `.env`; `ALLOWED_HOSTS` for every hostname typed, with Tailscale and reverse-proxy examples; the port mapping stays on loopback (a public bind passes host firewalls); `TRUST_PROXY` only on a single-user host behind a proxy that is the only way in. The default compose never forwards `ALLOW_UNAUTHENTICATED`; a documented override file (`tailscale-only.yml`, loaded through `COMPOSE_FILE`) does, for Tailscale-only hosts.
- **§5.5, §9 item 8.** The Dockerfile sets `NODE_ENV=production` and `IN_CONTAINER=1`; compose never passes `NODE_ENV`, `IN_CONTAINER`, `ALLOW_FIXTURE_PROVIDER` (nor the test-only `FIXTURE_COST_MICRO_GBP`) and has no `env_file`.
- **§7 Migrations, `app_lock`; decisions 32, 53, 63.** Backups live in `<dirname(DATABASE_PATH)>/backups` (`/data/backups`), the directory both bootstraps and `scripts/backup.mjs` use (it imports `backupsDirFor`), 5 kept; a second live app on the same database waits 90 s and exits 75; after a graceful stop the next start does not wait; after a hard kill the restarted app waits until the lock is stale (three missed 30 s beats) and takes it over. The `HEALTHCHECK` start period (240 s) covers that wait, the backup, migrations and seeding. CI proves the stop, the kill and the takeover.
- **§8.2; decisions 25, 34, 62.** `docs/scheduling.md` carries cron examples, pausing, missed firings and the cadence table, **generated** from the engine's `estimate` and `budgetFit` (Travelpayouts one free call per airport pair and month, never a metro; `runsPerMonth` unrounded); a test regenerates it; the spec's cost figures point to it (decision 62).
- **§8.3; decisions 56, 59.** `docs/setup.md` documents the SMTP settings (all or nothing; `implicit`/`starttls`; `none` loopback-only, so never in the container and only ever as shell variables for `pnpm dev`), one mailbox per address, `ALERT_EMAIL_MAX_PER_HOUR`, `APP_BASE_URL`, and "email not configured" suppression.
- **§11.** No banned word in any operator doc (core's `findBannedWords` with the one `BANNED_WORD_ALLOWLIST`).
- **§12.** `.env.example` is the §12 block (revision 26) verbatim; the full preset table lives in `docs/api-limits.md`, generated from `PLAN_PRESETS` and `TRAVELPAYOUTS_DEFAULTS`, its pence through core's `microGbpToPence` (decision 49) and its override names checked against `ALL_VARS`.
- **§13; decision 63.** Every Dockerfile, `.dockerignore`, compose, backup/restore, local-dev and docs rule listed there. The docs warn that `docker compose down -v` and volume removal destroy the database and the in-volume backups, make a daily backup copied off the volume a setup step, and give a restore that checks the backup and keeps the current database aside. The healthcheck is liveness only; a `degraded` health detail shows in the UI and the logs and is never a restart trigger. The image has no curl (decision 12).
- **§14.** pino JSON to stdout; compose bounds the json-file log (10 MB × 5); the docs show how to follow one execution with `jq`.
- **Decision 61.** Recorded vendor responses are local-only and never committed: `.gitignore` (on main) ignores them except our own `params-*.json` allowlists; `.dockerignore` keeps the whole recorded tree and raw bodies out of the image; `docs/setup.md` says so (sections 2 and 8) and gives the two git commands that check tracked files and history before publishing; per decision 63 the "commits … were purged" wording stays, because the purge lands before WP12 merges (Task 12.0 checks it).
- **Decision 26.** Tools run as the app's user: the image's `USER node` covers `docker compose exec`/`run`; compose sets no `user:`; the docs forbid `--user root` and say why.
- **Decisions 48, 49, 63.** `pnpm casts` and `pnpm boundaries` run in CI's `test` job, which the `docker` job needs; every action is pinned by commit SHA; WP12's TypeScript tests contain no cast (YAML goes through a zod schema) and no suppression comment; root-script tests are `scripts/*.test.mjs`.
- **Decision 62.** WP12 depends on 8, 9 and 11.

## 4. Interfaces consumed

As the code on main declares them, plus the WP8, WP9 and WP11 briefs for what is not merged yet (marked).

```ts
// @gmt/core (WP0–WP2, on main)
export const PENCE_TO_MICRO = 10_000;
export function microGbpToPence(micro: number): number;      // rounds up (decisions 47, 49)
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export type PlanPreset = ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number };
export const PLAN_PRESETS: Record<PlanId, PlanPreset>;      // 'trial' | '40usd'
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits;
export type DefinitionInput;                                 // the create schema's output is assignable to it
export * as apiContract;                                     // apiContract.definitionCreateRequestSchema
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;
export const BANNED_WORD_ALLOWLIST: readonly string[];       // ['smoke:live', 'lives in']
export function fixedClock(at: IsoDateTime): Clock & { … }; export function asIsoDate(s: string): IsoDate; export function asIsoDateTime(s: string): IsoDateTime;
export const systemClock: Clock;                             // scripts/backup.mjs, from the built dist

// @gmt/db (WP0, WP3, on main)
export function backupDatabase(dbPath: string, backupsDir: string, opts: { keep: number; clock: Clock; verify?: (file: string) => string }): { file: string };
//   throws "backup refused: <db> does not exist" | "backup refused: <dir> is world-writable" | "backup refused: <file> already exists (…)" | "backup failed for <db>: <cause>"
export function openDatabase(path: string): Db;               // the drift guard's sample file (apps/api never imports better-sqlite3, decision 23)
export const MIGRATIONS_DIR: string; export const AIRPORTS_DATA_DIR: string;
export function loadAirportsDataset(dir: string): AirportsDataset;            // { version; airports: Array<{ iata; … }>; metros: Record<string, string[]> }
// appLock.ts: heartbeat every 30 s, stale after 3 missed beats (LOCK_STALE_AFTER_MS = 90 000); a takeover logs
//   'taking over a stale app_lock (heartbeat older than 3 missed beats)'

// @gmt/engine (WP7, on main)
export function createEngine(deps: EngineDeps, options?: EngineOptions): Engine;
// Engine.estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate   (worst case without reuse, `blocked` filled)
// Engine.budgetFit(definition): { fits; runsPerMonth /* firings in the next 365 days ÷ 12, unrounded */; perScope: Array<{ scope /* 'provider-month:searchapi' … */; estimated; cap; fits }> }

// apps/api (WP4b, on main)
export const EXIT = { ok: 0, failed: 1, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;   // src/tools/types.ts → dist/tools/types.js
// src/bootstrap/preflight.ts → dist/bootstrap/preflight.js: backupsDirFor(databasePath) = join(dirname(databasePath), 'backups'); BACKUPS_KEPT = 5
// src/wiring.ts: loadConfigFromEnv resolves DATABASE_PATH with realpath (tolerantRealpath) before anything derives from it
// test/helpers/env.ts: ALL_VARS (every variable parseConfig reads; WP11 adds ALERT_EMAIL_MAX_PER_HOUR), SENTINEL_*, silentLog
// test/helpers/recording.ts: seededPorts(env?, clock?): Ports   (testEnv with both providers on sentinels, airports seeded, closed after the test)
// test/helpers/tmp.ts: tempDir(), onCleanup()
// package.json (root): "record:fixtures": "pnpm -C apps/api run tool record"; usage
//   `pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--out DIR] [--dry-run] [--confirm-rerun]`

// apps/api (WP8 brief, not on main)
// src/bootstrap/start.ts: the process entry (the image CMD runs dist/bootstrap/start.js); main(env) exits with BootError.exitCode from EXIT
// src/bootstrap/paths.ts: assetPaths().webRoot = apps/web/dist beside apps/api/dist
// GET /api/health: public and Host-exempt, { ok, degraded }; signed in, healthDetailSchema { db, providers, scheduler: { jobCount, nextRun, lastExecutionAt, degraded, blockedSince } }
// waitForLockFree: 60 s behind a tool lock, 90 s behind an app lock, logging 'waiting for app_lock' every 10 s, then 75
// SIGTERM: stop accepting → engine.shutdown() → wal_checkpoint(TRUNCATE) → lock release → exit 0
// POST /api/tools/record refuses inside a container (decision 62)
// "dev": "node --conditions=@gmt/source --import tsx --watch src/bootstrap/start.ts"   (no --env-file: the environment comes from the shell)

// apps/web (WP9 brief, not on main)
// src/example.ts: import example from '../../../docs/examples/london-new-york.json' with { type: 'json' };
//   export const EXAMPLE_DEFINITION = apiContract.definitionCreateRequestSchema.parse(example);

// WP11 brief (not on main): Config.alertEmailMaxPerHour from ALERT_EMAIL_MAX_PER_HOUR (default 20), added to ALL_VARS;
//   ALERT_EMAIL_TO/FROM one mailbox each; SMTP_TLS=none only for a loopback host (or `mailpit` under development);
//   with no SMTP an alert reaches the log only and its event is recorded `suppressed` ("email not configured").
```

## 5. Interfaces produced

- **Image** `get-me-there:local` (compose and CI): runs as `node` (uid 1000), `NODE_ENV=production`, `IN_CONTAINER=1`, data in the volume `get-me-there_gmt-data` at `/data`, backups in `/data/backups` (0700), port 3000, liveness by `GET /api/health`; scripts `backup.mjs`, `check-backup.mjs`, `assert-sqlite-prebuilt.mjs`, `assert-dist-resolution.mjs` only.
- **CLI** `node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n ≥ 1>]`: `--db` defaults to `DATABASE_PATH` (no other default: neither set is 64), resolved with realpath like the config; `--dir` to `backupsDirFor(db)`; `--keep` to `BACKUPS_KEPT`. Exit `EXIT.ok` prints exactly one line `{"ok":true,"file":"…"}`; `EXIT.usage` on bad arguments (stderr starts `usage: node scripts/backup.mjs`, stdout empty); `EXIT.backupFailed` `backup failed: <cause>` for every failure of the routine; 1 `backup: cannot load the built packages (run pnpm build): …` when the build is missing.
- **CLI** `node scripts/check-backup.mjs <file>`: opens the file read-only and runs `PRAGMA integrity_check`; `EXIT.ok` prints `{"ok":true,"file":"…"}`; `EXIT.usage` without exactly one file; `EXIT.backupFailed` `backup check failed: <cause>`; 1 when the build is missing.
- **CLI** `node scripts/assert-sqlite-prebuilt.mjs`: exit 0 prints `better-sqlite3 13.0.3 prebuilt ok: <path>`; exit 1 lists every failure. **CLI** `node scripts/assert-dist-resolution.mjs`: exit 0 prints `workspace packages resolve to dist`; exit 1 names each package that resolved elsewhere or not at all.
- **`docs/examples/london-new-york.json`**: the importable example, a `definitionCreateRequestSchema`-valid object. Contract with WP9: `apps/web/src/example.ts` imports it; Task 12.8 asserts equality.
- **Doc markers and sections** later packages rely on: `<!-- preset-table:start/end -->` (api-limits.md), `<!-- cadence-table:start/end -->` (scheduling.md), `<!-- example-definition:start/end -->`, `## 8. Fixture recording`, `## 10. Exit codes` … `## 11.` (setup.md). WP13 adds the smoke test to setup.md (a section and the exit codes 2 and 3) and changes the docs test that keeps them out until then.
- **Test helpers** `apps/api/test/deploy/files.ts` (`REPO`, `SPEC_PATH`, `read`, `between`, `dockerfileStages`, `envExampleVariables`, `specEnvBlock`), `presetTable.ts` (`ROWS`, `renderPresetTable`), `cadence.ts` (`CADENCE_DAY`, `exampleInput`, `cadenceCases`, `renderCadenceTable`).

## 6. Library notes

Verified on 2026-10-14 (images, better-sqlite3, Dockerfile and compose syntax) and re-exercised on 2026-10-17 by this revision's assembly (everything except a Docker build and the CI job: the Docker daemon was not running, so the Dockerfile was verified statically; `docker compose config`, which needs no daemon, was run with and without the override file).

- **Base image `node:22-slim`**: `docker buildx imagetools inspect node:22-slim` returned the multi-platform index digest `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` on 2026-10-14 (image created 2026-10-06, `NODE_VERSION=22.23.3`, Debian bookworm-slim). Pin the **index** digest so arm64 hosts get the same release. Task 12.1 Step 4 re-inspects it; the setup doc tells the operator to refresh it monthly. The image has no curl or wget, and nothing is installed from Debian.
- **better-sqlite3 13.0.3** (`packages/db`): lockfile integrity `sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==`. The tarball ships `prebuilds/{linux,linuxmusl,darwin,win32}-{x64,arm64}.node`, has no `install` script and `"gypfile": false`, so pnpm never runs node-gyp; fail-closed means the prebuilt exists, `build/` does not, the module loads (`scripts/assert-sqlite-prebuilt.mjs`). The CI image is amd64; on an arm64 host the same assertion runs in that host's build and stops it if `linux-arm64.node` were missing. `scripts/check-backup.mjs` uses `new Database(file, { readonly: true, fileMustExist: true })` and `db.pragma('integrity_check', { simple: true })`, the calls `backupDatabase`'s own check makes.
- **pnpm 12.9.1 via corepack**: Node 22 bundles corepack; `corepack enable pnpm` installs the shim; `"packageManager": "pnpm@12.9.1+sha512.06b055ff…0d6d"` (the hex form of npm's `dist.integrity` for `pnpm@12.9.1`, `sha512-BrBV//XN…wNbQ==`, read with `npm view` on 2026-10-17) makes corepack verify the download; the Dockerfile strips `+…` before comparing with `pnpm --version`. `pnpm install --frozen-lockfile --offline` accepted the hashed field on the assembly. `pnpm install --frozen-lockfile --prod --filter "@gmt/api..."` installs `@gmt/api` and its workspace dependencies' production trees only.
- **Dockerfile syntax** (context7 `/docker/docs`, "HEALTHCHECK"): `--interval`, `--timeout`, `--start-period` (failures inside it do not count), `--retries`; exec form `CMD ["node", "-e", "…"]`; `COPY --from=name` copies symlinks as links (pnpm's workspace links survive); `COPY` with several sources into a directory ending `/`; `RUN --mount=type=cache` (BuildKit). A fresh named volume takes the ownership and mode of the image directory it is mounted on. `.dockerignore` patterns match from the context root unless written `**/…`; `!` re-includes (`**/.npmrc` then `!.npmrc`).
- **Compose** (context7 `/docker/docs`; Docker Compose v5.5.0 locally): `${VAR:-default}` resolves from the shell, then `--env-file`, then the project `.env`; only the names under `environment:` reach the container. `COMPOSE_FILE=a.yml:b.yml` in the project `.env` makes every command read both files (the override adds `ALLOW_UNAUTHENTICATED`). `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`; `up -d --wait --wait-timeout <s>` waits for healthy; `run --rm --no-deps -T` starts a one-off container with the service's volume, user and hardening but no published port; `cp` reads from a stopped or running container. `docker compose --env-file /dev/null config --format json` on the assembly gave 54 `app` variables (55 with the override), the four hardening keys and no `mailpit` without `--profile dev`. SQLite's temporary files fall back to `/tmp` (the tmpfs) when `/var/tmp` is read-only.
- **GitHub Actions pins** (`git ls-remote` on 2026-10-17, the commit each current major tag points to): `actions/checkout@11d5960a326750d5838078e36cf38b85af677262` (v4 = v4.4.0), `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1` (v4 = v4.3.0), `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (v4 = v4.4.0), `docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` (v3 = v3.12.0).
- **Mailpit** (`dev` profile only): `axllent/mailpit@sha256:94f6b70c1436defae6799d9ac7ff0eeff9540465b842026d5cdb018f1c0234ea` (inspected 2026-10-14); SMTP on 1025, web UI on 8025.
- **yaml 2.9.1** (new `apps/api` dev dependency; npm integrity `sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==`): `import { parse } from 'yaml'`; `parse(str)` returns plain objects, throws on a syntax error (context7 `/eemeli/yaml`). Its result goes through a zod schema (no cast).
- **zod 4.6.7**: `z.looseObject`, `z.object`, `z.record(z.string(), …)`, `.parse`.
- **Vitest 5.0.4**: the `api` project (aliases, WP4b's network guards) runs `test/deploy/**`; the root `scripts` project (decision 49; inline in the root `vitest.config.ts` on main, or `scripts/vitest.config.mjs` after WP9 — both include `scripts/*.test.mjs`) runs the script tests; the `web` project runs under jsdom, whose `URL` class `node:fs` does not accept, so the web test builds plain paths.

## 7. Files

- **Create:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/assert-sqlite-prebuilt.mjs`, `scripts/assert-dist-resolution.mjs`, `scripts/backup.mjs`, `scripts/check-backup.mjs`, `docs/setup.md`, `docs/api-limits.md`, `docs/scheduling.md`, `docs/examples/london-new-york.json` (overwrites WP9's stand-in with identical bytes if present).
- **Test:** `scripts/assert-sqlite-prebuilt.test.mjs`, `scripts/backup.test.mjs`; `apps/api/test/deploy/files.ts`, `dockerfile.test.ts`, `envExample.test.ts`, `compose.test.ts`, `backupCli.test.ts`, `presetTable.ts`, `apiLimits.test.ts`, `cadence.ts`, `scheduling.test.ts`, `docs.test.ts`; `apps/web/test/example.test.ts`.
- **Modify:** `package.json` (root: `packageManager` hash), `.env.example` (generated from spec §12), `apps/api/package.json` (dev dependency `yaml` 2.9.1), `pnpm-lock.yaml`, `.github/workflows/ci.yml` (SHA pins, the grep step removed, the `docker` job).

## 8. Tasks

Per-task test runs use `pnpm --filter @gmt/api exec vitest run <files>` (no coverage threshold on a partial run, decision 8) and `pnpm vitest run --project scripts`.

### Task 12.0: Preconditions (stop and report to Fable if any fails)

No code. Run each check from the repository root on the branch's base; every one must print what is shown. A failure is not this package's to fix: report it to Fable with the output and wait.

| Precondition | Check | Expected |
|---|---|---|
| WP8 merged: the process entry, the web root, health, the lock wait, the record route's container refusal | `ls apps/api/src/bootstrap/start.ts apps/api/src/bootstrap/paths.ts && grep -c "waiting for app_lock" apps/api/src/bootstrap/lock.ts && grep -lr "IN_CONTAINER\|inContainer" apps/api/src/tools apps/api/src/routes` | both paths, a count ≥ 1, at least one file |
| `/api/health` is public in the contract | `grep -n "'/health'" packages/core/src/api-contract/index.ts` | a line with `auth: 'public'` (the route table adds the `/api` prefix) |
| WP9 merged: the example import and the web build | `grep -c "docs/examples/london-new-york.json" apps/web/src/example.ts && pnpm --filter @gmt/web build >/dev/null && ls apps/web/dist/index.html` | `1`, then the path |
| WP9's `scripts` Vitest project includes `scripts/*.test.mjs` | `grep -rn "test.mjs" vitest.config.ts scripts/vitest.config.mjs 2>/dev/null` | a line naming `*.test.mjs` |
| WP11 merged: the email ceiling in the config's variable list | `grep -c "'ALERT_EMAIL_MAX_PER_HOUR'" apps/api/test/helpers/env.ts` | `1` |
| Spec §12 at revision 26 defines the ceiling | `grep -c "^ALERT_EMAIL_MAX_PER_HOUR=" docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md` | `1` |
| Decision 61's history purge has landed | `git log --all --format= --name-only -- packages/providers/fixtures/recorded \| grep -Ev '(^$\|params-[^/]*\.json$\|\.gitkeep$)' \| sort -u` | no output |

### Task 12.1: Dockerfile, `.dockerignore` and the image assertions (first failing test)

**Files:**
- Create: `apps/api/test/deploy/files.ts`, `Dockerfile`, `.dockerignore`, `scripts/assert-sqlite-prebuilt.mjs`, `scripts/assert-dist-resolution.mjs`
- Modify: `package.json` (root `packageManager`)
- Test: `apps/api/test/deploy/dockerfile.test.ts`, `scripts/assert-sqlite-prebuilt.test.mjs`

**Interfaces:**
- Consumes: `pnpm-lock.yaml`; WP8's `start.ts` and `assetPaths()` layout (Task 12.0); the build outputs `packages/*/dist`, `apps/api/dist`, `apps/web/dist`; `packages/db/drizzle`, `packages/db/data`.
- Produces: the image; the two assertion scripts; the deploy test helpers.

- [ ] **Step 1: The deploy test helpers**

`apps/api/test/deploy/files.ts`:

```ts
// Readers for the repository-level files WP12 ships (Dockerfile, compose, .env.example, docs), shared by the deploy
// tests. They live in apps/api's test tree because the image runs this app: the tests type-check with its
// tsconfig.test.json, pass `pnpm casts` and resolve workspace packages through its Vitest aliases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file so the tests run from any cwd. */
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

export const SPEC_PATH = 'docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md';

/** A repository file as UTF-8. */
export function read(relativePath: string): string {
  return readFileSync(join(REPO, relativePath), 'utf8');
}

/** Text strictly between the first `start` marker and the next `end` marker; throws if either is missing. */
export function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`marker not found: ${start}`);
  const j = text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`marker not found: ${end}`);
  return text.slice(i + start.length, j);
}

export interface DockerStage {
  from: string;
  instructions: string[];
}

/**
 * A Dockerfile split into stages of logical instructions: backslash continuations joined, comments and blank lines
 * dropped, whitespace collapsed. Enough for assertions on our own Dockerfile; not a general parser.
 */
export function dockerfileStages(text: string): DockerStage[] {
  const logical: string[] = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (current === '' && (line === '' || line.startsWith('#'))) continue;
    if (line.endsWith('\\')) {
      current += `${line.slice(0, -1).trim()} `;
      continue;
    }
    logical.push(`${current}${line}`.replace(/\s+/g, ' ').trim());
    current = '';
  }
  const stages: DockerStage[] = [];
  for (const instruction of logical) {
    if (instruction.startsWith('FROM ')) stages.push({ from: instruction, instructions: [] });
    else stages.at(-1)?.instructions.push(instruction);
  }
  return stages;
}

/**
 * Every variable name a spec §12 style block defines: `NAME=` lines plus the names in each
 * `# overrides: FULL_NAME, _SUFFIX, …` comment (a suffix takes the first name's prefix). Commented assignments
 * (`# IN_CONTAINER=1`) are not operator variables and are skipped.
 */
export function envExampleVariables(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    const assign = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (assign?.[1]) names.add(assign[1]);
    const overrides = /^# overrides: (.+)$/.exec(line);
    if (overrides?.[1]) {
      const items = overrides[1].split(',').map((s) => s.trim());
      const first = items[0] ?? '';
      const prefix = first.slice(0, first.indexOf('_'));
      for (const item of items) names.add(item.startsWith('_') ? `${prefix}${item}` : item);
    }
  }
  return [...names].sort();
}

/** The fenced block that follows the "## 12. Configuration" heading of the spec. */
export function specEnvBlock(): string {
  const section = read(SPEC_PATH).split('## 12. Configuration')[1] ?? '';
  return between(section, '```\n', '\n```');
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/deploy/dockerfile.test.ts`:

```ts
// Spec §13 Dockerfile and .dockerignore, §5.5 and §9 item 8 (the production flags), plan decisions 12 (no curl in
// the image), 61 (recordings stay out), 26 (one non-root user) and 53 (the start period covers the lock wait).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dockerfileStages, REPO, read } from './files.js';

const stages = dockerfileStages(read('Dockerfile'));
const runtime = stages.at(-1)?.instructions ?? [];
const all = stages.flatMap((s) => s.instructions);
const indexOf = (predicate: (s: string) => boolean) => runtime.findIndex(predicate);

describe('Dockerfile (spec §13, §5.5, §9 item 8)', () => {
  it('sets production and the container flag in the runtime stage, and NODE_ENV nowhere else', () => {
    expect(runtime).toContain('ENV NODE_ENV=production');
    expect(runtime).toContain('ENV IN_CONTAINER=1');
    expect(all.filter((i) => /\bNODE_ENV=/.test(i))).toEqual(['ENV NODE_ENV=production']);
    expect(all.some((i) => /ALLOW_FIXTURE_PROVIDER|FIXTURE_COST_MICRO_GBP/.test(i))).toBe(false);
  });

  it('pins every stage to the same node:22-slim index digest', () => {
    expect(stages.length).toBe(3);
    const digests = stages.map(
      (s) => /^FROM node:22-slim@sha256:([0-9a-f]{64}) AS (?:build|prod-deps|runtime)$/.exec(s.from)?.[1],
    );
    expect(digests.every((d) => d !== undefined)).toBe(true);
    expect(new Set(digests).size).toBe(1);
  });

  it('runs as the non-root user node from the last RUN onwards (decision 26)', () => {
    const lastRun = runtime.map((i) => i.startsWith('RUN ')).lastIndexOf(true);
    expect(all.filter((i) => i.startsWith('USER '))).toEqual(['USER node']);
    expect(indexOf((i) => i === 'USER node')).toBeGreaterThan(lastRun);
  });

  it('creates /data and /data/backups owned by node, backups 0700, before declaring the volume', () => {
    const prepare = indexOf(
      (i) =>
        i.startsWith('RUN ') &&
        i.includes('mkdir -p /data/backups') &&
        i.includes('chown -R node:node /data') &&
        i.includes('chmod 0700 /data/backups'),
    );
    const volume = indexOf((i) => i === 'VOLUME ["/data"]');
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(volume).toBeGreaterThan(prepare);
  });

  it('installs no package from the distribution: no apt-get, curl or wget (decision 12)', () => {
    expect(all.some((i) => /\b(apt-get|apt|apk|curl|wget)\b/.test(i))).toBe(false);
  });

  it('has a node fetch HEALTHCHECK of /api/health whose start period covers the lock wait and boot (≥ 180 s)', () => {
    const hc = runtime.find((i) => i.startsWith('HEALTHCHECK '));
    expect(hc).toBeDefined();
    expect(Number(/--start-period=(\d+)s/.exec(hc ?? '')?.[1])).toBeGreaterThanOrEqual(180);
    expect(hc).toContain('CMD ["node", "-e",');
    expect(hc).toContain("fetch('http://127.0.0.1:3000/api/health')");
  });

  it("starts WP8's process entry from its build output", () => {
    expect(runtime.at(-1)).toBe('CMD ["node", "apps/api/dist/bootstrap/start.js"]');
    expect(existsSync(join(REPO, 'apps/api/src/bootstrap/start.ts'))).toBe(true);
  });

  it('copies migrations, the airports dataset, the web build and only the scripts the image runs', () => {
    for (const path of ['/app/packages/db/drizzle', '/app/packages/db/data', '/app/apps/web/dist']) {
      expect(runtime.some((i) => i.startsWith('COPY --from=build ') && i.includes(` ${path} `))).toBe(true);
    }
    expect(runtime.some((i) => i.startsWith('COPY --from=prod-deps /app/node_modules '))).toBe(true);
    expect(runtime.some((i) => /fixtures/.test(i))).toBe(false);
    // why: review arch-wp12-r1-010, sec-008 — the lint, scan and test scripts stay out of the image
    const scripts = runtime.filter((i) => i.startsWith('COPY --from=build /app/scripts'));
    expect(scripts).toEqual([
      'COPY --from=build /app/scripts/backup.mjs /app/scripts/check-backup.mjs /app/scripts/assert-sqlite-prebuilt.mjs /app/scripts/assert-dist-resolution.mjs ./scripts/',
    ]);
  });

  it('takes no build argument or build secret, so no credential can enter a layer', () => {
    expect(all.some((i) => /^ARG\b/.test(i) || i.includes('--mount=type=secret'))).toBe(false);
  });

  it('builds every package and never opts the runtime into the @gmt/source condition', () => {
    expect(stages.find((s) => s.from.endsWith(' AS build'))?.instructions).toContain('RUN pnpm build');
    expect(all.join('\n')).not.toMatch(/--conditions|NODE_OPTIONS|@gmt\/source/);
    expect(runtime.some((i) => i.includes('/src'))).toBe(false);
    expect(runtime).toContain('RUN node scripts/assert-dist-resolution.mjs');
  });

  it('installs with the frozen lockfile and pnpm from packageManager, and asserts the sqlite prebuilt in every stage', () => {
    const text = all.join('\n');
    expect(text).toMatch(/pnpm install --frozen-lockfile --store-dir/);
    expect(text).toMatch(/pnpm install --frozen-lockfile --prod --filter "@gmt\/api\.\.\."/);
    expect(text).toContain('corepack enable pnpm');
    expect(text).toContain('packageManager');
    // why: corepack verifies the pnpm download only when packageManager carries its hash (review devops-010)
    expect(JSON.parse(read('package.json')).packageManager).toMatch(/^pnpm@12\.9\.1\+sha512\.[0-9a-f]{128}$/);
    for (const s of stages)
      expect(s.instructions.some((i) => i.startsWith('RUN node scripts/assert-sqlite-prebuilt.mjs'))).toBe(
        true,
      );
  });
});

describe('.dockerignore (spec §13; decision 61)', () => {
  const lines = read('.dockerignore')
    .split('\n')
    .map((l) => l.trim());
  it.each([
    '.env*',
    '**/.env*',
    'data/',
    'backups/',
    '*.db*',
    '**/*.db*',
    'fixtures/recorded/',
    '**/fixtures/recorded/',
    '**/*.raw.json',
    'node_modules/',
    '**/node_modules/',
    '.worktrees/',
    '.git/',
    '.claude/',
    '**/*.pem',
    '**/*.key',
    '**/.npmrc',
    'private/',
  ])('excludes %s', (entry) => {
    expect(lines).toContain(entry);
  });

  it('keeps the root .npmrc, which holds no credential', () => {
    expect(lines).toContain('!.npmrc');
    expect(read('.npmrc')).not.toMatch(/_auth|_authToken|_password|\/\/[^\s]+:/);
  });

  it('keeps docs/ (the web build imports docs/examples) and the airports dataset in the build context', () => {
    expect(lines.some((l) => /^(\*\*\/)?docs\/?(\*\*)?$/.test(l))).toBe(false);
    expect(lines.some((l) => l === '**/data/' || l.startsWith('packages/db'))).toBe(false);
  });
});
```

`scripts/assert-sqlite-prebuilt.test.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// why: decision 49 — the root scripts' tests sit beside them. The image runs this script three times (spec §4, §13:
// the better-sqlite3 prebuilt is fail-closed, version pinned by the lockfile, integrity recorded in the WP12 brief).
const REPO = fileURLToPath(new URL('../', import.meta.url));

describe('scripts/assert-sqlite-prebuilt.mjs', () => {
  it('pnpm-lock.yaml pins better-sqlite3 13.0.3 to the integrity recorded in the WP12 brief', () => {
    const lock = readFileSync(join(REPO, 'pnpm-lock.yaml'), 'utf8').split('\n');
    const at = lock.findIndex((l) => l.trim() === 'better-sqlite3@13.0.3:');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lock.slice(at, at + 3).join('\n')).toContain(
      'sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==',
    );
  });

  it('passes on this machine and names the prebuilt it loaded', () => {
    const r = spawnSync(process.execPath, ['scripts/assert-sqlite-prebuilt.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /^better-sqlite3 13\.0\.3 prebuilt ok: .*prebuilds[/\\][a-z0-9]+-[a-z0-9]+\.node\n$/,
    );
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/dockerfile.test.ts`
Expected: FAIL while collecting, `ENOENT: no such file or directory, open '…/Dockerfile'` (WP8's `start.ts` exists by Task 12.0, so no other cause).

Run: `pnpm vitest run --project scripts assert-sqlite-prebuilt`
Expected: the lockfile test PASSES (WP0 pinned it); "passes on this machine" FAILS with status 1 and `Cannot find module '…/scripts/assert-sqlite-prebuilt.mjs'` in stderr.

- [ ] **Step 4: Confirm the base image**

Run: `docker buildx imagetools inspect node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 | head -3` and `docker run --rm node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 sh -c 'corepack --version; command -v curl || echo no-curl'`
Expected: the digest resolves; a corepack version (0.3x.y) and `no-curl`. If corepack is missing or curl is present, stop and report to Fable.

- [ ] **Step 5: Implement**

Root `package.json`, the `packageManager` field (the hex form of npm's `dist.integrity` for `pnpm@12.9.1`; to recompute: `node -e "console.log(Buffer.from(process.argv[1].slice(7),'base64').toString('hex'))" "$(npm view pnpm@12.9.1 dist.integrity)"`):

```json
"packageManager": "pnpm@12.9.1+sha512.06b055fff5cd20dc12781de173ced3310ce0951bf2ec620211a16045d5444d5c93a663210764ef29a653a610459ba0368f0e74f84d80c54723cf95aae7bc0d6d",
```

Then `pnpm install --frozen-lockfile` must still exit 0 with no lockfile change.

`scripts/assert-sqlite-prebuilt.mjs`:

```js
#!/usr/bin/env node
// Fails unless better-sqlite3 runs from the prebuilt binary shipped inside its npm tarball.
// Spec §4 and §13: the prebuilt is fail-closed, with no source-build fallback.
//
// why: better-sqlite3 13.x has no install script; prebuilds/<platform>-<arch>.node arrives in
// the tarball whose sha512 pnpm-lock.yaml pins. Its loader (lib/binding.js) falls back to
// build/Release/better_sqlite3.node when no prebuilt matches, so this script requires the
// prebuilt to exist, requires build/ to be absent, and loads the module once.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const EXPECTED_VERSION = '13.0.3';

// why: resolve from packages/db, the only workspace package that depends on better-sqlite3,
// so the script works in the repository and in the image (which keeps the workspace layout).
const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pkgPath = requireFromDb.resolve('better-sqlite3/package.json');
const root = dirname(pkgPath);
const { version } = requireFromDb('better-sqlite3/package.json');
const prebuilt = join(root, 'prebuilds', `${process.platform}-${process.arch}.node`);

const failures = [];
if (version !== EXPECTED_VERSION)
  failures.push(`better-sqlite3 ${version} resolved, expected ${EXPECTED_VERSION}`);
if (!existsSync(prebuilt)) failures.push(`no prebuilt binary at ${prebuilt}`);
if (existsSync(join(root, 'build')))
  failures.push(`a source build exists at ${join(root, 'build')}; refusing it`);

if (failures.length === 0) {
  try {
    const Database = requireFromDb('better-sqlite3');
    const db = new Database(':memory:');
    db.prepare('select sqlite_version() as v').get();
    db.close();
  } catch (err) {
    failures.push(`better-sqlite3 failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`better-sqlite3 ${version} prebuilt ok: ${prebuilt}`);
```

`scripts/assert-dist-resolution.mjs`:

```js
#!/usr/bin/env node
// Fails the image build unless every workspace package the app imports resolves to its built
// dist/ entry under Node's default conditions. Plan decision 15: package exports carry a
// "@gmt/source" condition for tests; the runtime must never resolve it (src/ is not in the image).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const failures = [];
for (const name of ['@gmt/core', '@gmt/db', '@gmt/providers', '@gmt/engine']) {
  try {
    const resolved = requireFromApi.resolve(name);
    if (!/[/\\]dist[/\\]/.test(resolved)) failures.push(`${name} resolved outside dist: ${resolved}`);
    else if (!existsSync(resolved)) failures.push(`${name} resolved to a missing file: ${resolved}`);
  } catch (err) {
    failures.push(`${name} did not resolve: ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('workspace packages resolve to dist');
```

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# get-me-there image. Spec §13 (deployment), §5.5 (NODE_ENV and IN_CONTAINER), §4 (fail-closed sqlite).
#
# Base image pin: the multi-platform INDEX digest of node:22-slim. To refresh it run
#   docker buildx imagetools inspect node:22-slim
# copy the top-level "Digest:" line into every FROM below, and update this block and the
# "Library notes" of docs/briefs/wp12-docker-docs.md.
# Recorded 2026-10-14: sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
#   (image created 2026-10-06, NODE_VERSION 22.23.3, Debian bookworm-slim).
# why node 22: it still bundles corepack; it is the supported runtime of spec §4. corepack verifies the
# pnpm download against the sha512 in package.json `packageManager`.
# why no apt-get anywhere: the image carries no curl or wget (spec §13); the health check and the
# operator's tool calls use node's fetch inside and curl on the host.

# ---- build: full install, sqlite assertion, every package and the SPA built ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY . .
RUN corepack enable pnpm \
 && test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').replace(/\\+.*$/, '')")"
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
RUN node scripts/assert-sqlite-prebuilt.mjs
RUN pnpm build

# ---- prod-deps: production dependencies of @gmt/api and its workspace dependencies only ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS prod-deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY . .
RUN corepack enable pnpm \
 && test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').replace(/\\+.*$/, '')")"
# why: the filter keeps the SPA's React/Vite tree out of the runtime image; the SPA ships as static files.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@gmt/api..." --store-dir /pnpm/store
RUN node scripts/assert-sqlite-prebuilt.mjs

# ---- runtime ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production
ENV IN_CONTAINER=1
WORKDIR /app
# why: the image keeps the workspace layout (root node_modules/.pnpm plus per-package symlinks), so
# workspace imports, the db package's migrations and airports paths, WP8's web root
# (apps/api/dist/bootstrap → apps/web/dist) and scripts/backup.mjs resolve exactly as in the repository.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps /app/packages/providers/node_modules ./packages/providers/node_modules
COPY --from=prod-deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/db/package.json ./packages/db/package.json
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/data ./packages/db/data
COPY --from=build /app/packages/providers/package.json ./packages/providers/package.json
COPY --from=build /app/packages/providers/dist ./packages/providers/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# why: only the scripts the image runs; the repository's lint, scan and test scripts stay out.
COPY --from=build /app/scripts/backup.mjs /app/scripts/check-backup.mjs /app/scripts/assert-sqlite-prebuilt.mjs /app/scripts/assert-dist-resolution.mjs ./scripts/
RUN node scripts/assert-dist-resolution.mjs
# why: a fresh named volume copies the ownership and mode of the image directory it is mounted on,
# so /data must exist and belong to node before VOLUME, or the first boot cannot write the database.
# /data/backups is 0700 like the directory @gmt/db's backupDatabase creates (it refuses a
# world-writable one); backups are <dirname(DATABASE_PATH)>/backups.
RUN node scripts/assert-sqlite-prebuilt.mjs \
 && mkdir -p /data/backups \
 && chown -R node:node /data \
 && chmod 0700 /data/backups
VOLUME ["/data"]
# why: non-root; every process started with `docker compose exec` or `run` is node as well, so the
# app, the backup script and the tools share one owner for the database and its -wal/-shm side
# files (plan decision 26).
USER node
EXPOSE 3000
# why: liveness only (plan decision 63): a 2xx answer from /api/health is healthy; a `degraded` detail
# (scheduler jobs missing, a stuck run) shows in the UI and the logs and is never a restart trigger.
# The start period 240 s covers the read-only app_lock wait (up to 90 s behind another app's lock,
# 60 s behind a tool's, plan decision 53), the pre-migration backup, migrations and airport seeding.
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/bootstrap/start.js"]
```

`.dockerignore`:

```
# Secrets and local state never enter the build context (spec §13). Patterns without **/ match
# only at the context root, so the nested forms cover worktrees and package folders too.
.env*
**/.env*
data/
backups/
**/backups/
*.db*
**/*.db*
# Keys and certificates, a private notes folder, and any nested npm config that could hold a token.
# The root .npmrc stays (engine-strict, peer rules) and a test keeps it free of credentials.
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/id_rsa*
**/id_ed25519*
private/
**/private/
**/.npmrc
!.npmrc
# Recorded vendor responses are local-only and never committed or shipped (plan decision 61): the
# whole recorded tree stays out of the image, our params-*.json allowlists included (the runtime
# allowlists are code constants); raw bodies too.
fixtures/recorded/
**/fixtures/recorded/
**/*.raw.json
# Rebuilt inside the image.
node_modules/
**/node_modules/
**/dist/
**/coverage/
reports/
**/.stryker-tmp/
# Repository metadata and other checkouts.
.git/
.github/
.claude/
.memsearch/
.worktrees/
.superpowers/
```

The runtime stage copies `scripts/check-backup.mjs`, which Task 12.4 creates: the image build in Step 6 runs after Task 12.4, the unit tests here do not need it.

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/dockerfile.test.ts && pnpm vitest run --project scripts assert-sqlite-prebuilt`
Expected: PASS, 31 tests (11 Dockerfile, 20 `.dockerignore`) and 2 tests.

After Task 12.4, run: `docker build -t get-me-there:local .`
Expected: the log shows `better-sqlite3 13.0.3 prebuilt ok: /app/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/prebuilds/linux-x64.node` three times (`linux-arm64.node` on arm64 hosts) and `workspace packages resolve to dist`, and ends `naming to docker.io/library/get-me-there:local`. Then `docker run --rm --entrypoint id get-me-there:local -u` prints `1000` and `docker run --rm --entrypoint ls get-me-there:local scripts` prints exactly the four scripts.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore package.json scripts/assert-sqlite-prebuilt.mjs scripts/assert-sqlite-prebuilt.test.mjs scripts/assert-dist-resolution.mjs apps/api/test/deploy
git commit -m "wp12: non-root Dockerfile with production flags, digest and pnpm hash pins, fail-closed sqlite prebuilt"
```

### Task 12.2: `.env.example` equal to spec §12 and to the config's variables

**Files:**
- Modify: `.env.example`
- Test: `apps/api/test/deploy/envExample.test.ts`

**Interfaces:**
- Consumes: `ALL_VARS` (WP4b `apps/api/test/helpers/env.ts`, extended by WP11; Task 12.0), the spec §12 block at revision 26 (Task 12.0), `envExampleVariables`, `specEnvBlock` (Task 12.1).

- [ ] **Step 1: Write the failing test**

`apps/api/test/deploy/envExample.test.ts`:

```ts
// Spec §12: .env.example is the spec's block verbatim, and it names every variable the config reads.
import { describe, expect, it } from 'vitest';
import { ALL_VARS } from '../helpers/env.js';
import { envExampleVariables, read, specEnvBlock } from './files.js';

/**
 * Variables the config reads that .env.example must not offer: IN_CONTAINER is set by the Dockerfile (it appears
 * only commented), FIXTURE_COST_MICRO_GBP exists for engine tests under the synthetic gate (plan "Config").
 */
const NOT_OPERATOR = ['IN_CONTAINER', 'FIXTURE_COST_MICRO_GBP'];

describe('.env.example (spec §12)', () => {
  it('is the spec §12 block verbatim', () => {
    expect(read('.env.example')).toBe(`${specEnvBlock()}\n`);
  });

  it('defines exactly the variables the config reads, overrides expanded (WP4b ALL_VARS)', () => {
    const expected = ALL_VARS.filter((n) => !NOT_OPERATOR.includes(n)).sort();
    expect(envExampleVariables(read('.env.example'))).toEqual(expected);
    expect(expected).toEqual(
      expect.arrayContaining(['ALERT_EMAIL_MAX_PER_HOUR', 'APP_BASE_URL', 'TRUST_PROXY']),
    );
  });

  it('carries no value for any credential', () => {
    for (const name of ['APP_BASIC_AUTH_PASS', 'TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY', 'SMTP_PASS'])
      expect(read('.env.example')).toMatch(new RegExp(`^${name}=( |$)`, 'm'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/envExample.test.ts`
Expected: FAIL on "is the spec §12 block verbatim" (WP0's file starts with an extra header line and lacks `ALERT_EMAIL_MAX_PER_HOUR`) and on the variable set (missing `ALERT_EMAIL_MAX_PER_HOUR`). The credential test passes.

- [ ] **Step 3: Implement**

Run: `node -e "const fs=require('node:fs');const s=fs.readFileSync('docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md','utf8').split('## 12. Configuration')[1];const a=s.indexOf('\`\`\`\n')+4;const b=s.indexOf('\n\`\`\`',a);fs.writeFileSync('.env.example',s.slice(a,b)+'\n')"`

`// why:` generating the file from the spec removes any hand-copy drift; the test keeps it equal from now on. `.env.example` holds no value; `.env` is a different file and is never read or printed here.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/envExample.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/api/test/deploy/envExample.test.ts && git commit -m "wp12: .env.example equals spec §12 and names every variable the config reads"
```

### Task 12.3: `docker-compose.yml`: allowlist, auth always on, hardening

**Files:**
- Create: `docker-compose.yml`
- Modify: `apps/api/package.json` (dev dependency `yaml` 2.9.1), `pnpm-lock.yaml`
- Test: `apps/api/test/deploy/compose.test.ts`

**Interfaces:**
- Consumes: `envExampleVariables` (Task 12.1), `.env.example` (Task 12.2).
- Produces: services `app` and `mailpit`, volume `gmt-data` (Docker names it `get-me-there_gmt-data`).

Rules (spec §5.5, §13; decision 63; reviews sec-002, sec-003, devops-009, devops-011): the container receives every operator variable except `ALLOW_UNAUTHENTICATED`, which only the documented `tailscale-only.yml` override adds; `DATABASE_PATH`, `PORT` and `BIND_ADDRESS` are fixed (the header says so and where to change the host port); the root filesystem is read-only with a `/tmp` tmpfs, every capability is dropped and privilege escalation is off (the app writes only `/data`; CI boots it this way, Task 12.9).

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @gmt/api add -D -E yaml@2.9.1`
Expected: `apps/api/package.json` gains `"yaml": "2.9.1"` under `devDependencies`; the lockfile gains `yaml@2.9.1` (and `vite`'s optional peer entries pick it up; no other version changes).

- [ ] **Step 2: Write the failing test**

`apps/api/test/deploy/compose.test.ts`:

```ts
// Spec §13 docker-compose.yml and §5.5 (the environment allowlist); plan decision 53 (one app per volume) and the
// spec's Mailpit rule (host-side development only).

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { envExampleVariables, read } from './files.js';

// why: the parsed YAML is unknown; a schema states the shape the tests read, so nothing is cast (decision 48).
const serviceSchema = z.looseObject({
  build: z.unknown().optional(),
  image: z.string().optional(),
  init: z.boolean().optional(),
  restart: z.string().optional(),
  stop_grace_period: z.string().optional(),
  user: z.unknown().optional(),
  read_only: z.boolean().optional(),
  tmpfs: z.array(z.string()).optional(),
  cap_drop: z.array(z.string()).optional(),
  security_opt: z.array(z.string()).optional(),
  ports: z.array(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  env_file: z.unknown().optional(),
  healthcheck: z.unknown().optional(),
  depends_on: z.unknown().optional(),
  logging: z.object({ driver: z.string(), options: z.record(z.string(), z.string()) }).optional(),
  profiles: z.array(z.string()).optional(),
});
const composeSchema = z.object({
  name: z.string(),
  services: z.object({ app: serviceSchema, mailpit: serviceSchema }),
  volumes: z.record(z.string(), z.unknown()),
});

const compose = composeSchema.parse(parse(read('docker-compose.yml')));
const app = compose.services.app;
const env = app.environment ?? {};

/** Variables compose must never pass (spec §5.5, §12): the Dockerfile sets the first two; the rest are dev/test only. */
const NEVER = ['NODE_ENV', 'IN_CONTAINER', 'ALLOW_FIXTURE_PROVIDER', 'FIXTURE_COST_MICRO_GBP'];
/** Forwarded only by the documented Tailscale-only override file, never by the default compose (decision 63). */
const OVERRIDE_ONLY = ['ALLOW_UNAUTHENTICATED'];
/** Values compose fixes because the image layout or the published port depends on them. */
const FIXED: Readonly<Record<string, string>> = {
  DATABASE_PATH: '/data/get-me-there.db',
  PORT: '3000',
  BIND_ADDRESS: '0.0.0.0',
};

describe('docker-compose.yml app service (spec §13, §5.5)', () => {
  it('passes an explicit allowlist: every .env.example variable except the never-passed and override-only ones', () => {
    const expected = envExampleVariables(read('.env.example')).filter(
      (n) => !NEVER.includes(n) && !OVERRIDE_ONLY.includes(n),
    );
    expect(Object.keys(env).sort()).toEqual(expected);
  });

  it('never passes NODE_ENV, IN_CONTAINER, ALLOW_FIXTURE_PROVIDER or FIXTURE_COST_MICRO_GBP, and has no env_file', () => {
    for (const name of NEVER) expect(env).not.toHaveProperty(name);
    expect(app.env_file).toBeUndefined();
  });

  it('interpolates every non-fixed variable with an empty default and nothing else', () => {
    for (const [name, value] of Object.entries(env)) expect(value).toBe(FIXED[name] ?? `\${${name}:-}`);
  });

  it("publishes on loopback only and runs as the image's user", () => {
    expect(app.ports).toEqual(['127.0.0.1:3000:3000']);
    expect(app.user).toBeUndefined();
  });

  it('stores /data on the named volume, never a bind mount', () => {
    expect(app.volumes).toEqual(['gmt-data:/data']);
    expect(compose.volumes).toHaveProperty('gmt-data');
  });

  it('keeps basic auth on: ALLOW_UNAUTHENTICATED is not forwarded (decision 63)', () => {
    expect(env).not.toHaveProperty('ALLOW_UNAUTHENTICATED');
  });

  it('runs with a read-only root, a /tmp tmpfs, no capabilities and no privilege escalation', () => {
    expect(app.read_only).toBe(true);
    expect(app.tmpfs).toEqual(['/tmp']);
    expect(app.cap_drop).toEqual(['ALL']);
    expect(app.security_opt).toEqual(['no-new-privileges:true']);
  });

  it('inherits the image HEALTHCHECK (one source of truth, asserted in dockerfile.test.ts)', () => {
    expect(app.healthcheck).toBeUndefined();
  });

  it('restarts unless stopped, has a 30 s grace period, an init process and bounded logs', () => {
    expect(app.restart).toBe('unless-stopped');
    expect(app.stop_grace_period).toBe('30s');
    expect(app.init).toBe(true);
    expect(app.logging).toEqual({ driver: 'json-file', options: { 'max-size': '10m', 'max-file': '5' } });
  });
});

describe('docker-compose.yml mailpit service (spec §13: host-side development only)', () => {
  const mailpit = compose.services.mailpit;
  it('exists only under the dev profile, pinned by digest, on loopback ports', () => {
    expect(mailpit.profiles).toEqual(['dev']);
    expect(mailpit.image).toMatch(/^axllent\/mailpit@sha256:[0-9a-f]{64}$/);
    expect(mailpit.ports).toEqual(['127.0.0.1:1025:1025', '127.0.0.1:8025:8025']);
  });
  it('the app has no profile and no dependency on it, so `docker compose up` never starts mailpit', () => {
    expect(app.profiles).toBeUndefined();
    expect(app.depends_on).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/compose.test.ts`
Expected: FAIL while collecting, `ENOENT … docker-compose.yml`.

- [ ] **Step 4: Implement**

`docker-compose.yml`:

```yaml
# get-me-there: one app container, one SQLite file on a named volume. Spec §13.
#
# Configuration: write your values in .env next to this file (gitignored; see docs/setup.md). Compose
# reads .env for ${...} interpolation only; the container receives exactly the names listed under
# `environment:` below. That list is the allowlist of spec §5.5 and §13: NODE_ENV and IN_CONTAINER come
# from the Dockerfile, and ALLOW_FIXTURE_PROVIDER and FIXTURE_COST_MICRO_GBP are never passed. Do not
# add `env_file:`, which would forward every line of .env and defeat the allowlist.
#
# Basic auth is always on here: ALLOW_UNAUTHENTICATED is not forwarded (plan decision 63). A host reachable only
# over Tailscale may turn it off with the override file shown in docs/setup.md section 3, never by editing this file.
# DATABASE_PATH, PORT and BIND_ADDRESS are fixed below because the image layout and the published port depend on
# them; to use another host port, change the left side of `ports:` and keep 127.0.0.1.
#
# One app per volume: a second app started on the same database waits up to 90 s and exits 75 while
# this one is alive (plan decision 53). Tools and backups run inside this container as its user,
# `node` (`docker compose exec app …`, never `--user root`; plan decision 26).
name: get-me-there

services:
  app:
    build: .
    image: get-me-there:local
    # why: tini as PID 1 forwards SIGTERM so the app checkpoints WAL and releases app_lock (spec §7).
    init: true
    restart: unless-stopped
    stop_grace_period: 30s
    # why: the app writes only /data (the volume) and temporary files; nothing else needs to change at run time,
    # and a non-root process needs no capability (review sec-003).
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - gmt-data:/data
    environment:
      # --- fixed by the image layout and the published port ---
      DATABASE_PATH: "/data/get-me-there.db"
      PORT: "3000"
      BIND_ADDRESS: "0.0.0.0"
      # --- core ---
      ALLOWED_HOSTS: "${ALLOWED_HOSTS:-}"
      APP_BASE_URL: "${APP_BASE_URL:-}"
      APP_BASIC_AUTH_USER: "${APP_BASIC_AUTH_USER:-}"
      APP_BASIC_AUTH_PASS: "${APP_BASIC_AUTH_PASS:-}"
      TRUST_PROXY: "${TRUST_PROXY:-}"
      LOG_LEVEL: "${LOG_LEVEL:-}"
      POINT_OF_SALE: "${POINT_OF_SALE:-}"
      STALE_AFTER_HOURS: "${STALE_AFTER_HOURS:-}"
      CALENDAR_STALE_AFTER_HOURS: "${CALENDAR_STALE_AFTER_HOURS:-}"
      STUCK_AFTER_HOURS: "${STUCK_AFTER_HOURS:-}"
      MAX_CELLS_PER_DEFINITION: "${MAX_CELLS_PER_DEFINITION:-}"
      SCHEDULER_TIMEZONE: "${SCHEDULER_TIMEZONE:-}"
      AUTO_RESUME: "${AUTO_RESUME:-}"
      MAX_AUTO_RESUMES: "${MAX_AUTO_RESUMES:-}"
      MAX_WAIT_SECONDS: "${MAX_WAIT_SECONDS:-}"
      REQUEST_TIMEOUT_SECONDS: "${REQUEST_TIMEOUT_SECONDS:-}"
      ESTIMATE_RETRY_FACTOR: "${ESTIMATE_RETRY_FACTOR:-}"
      FX_MAX_RATE_AGE_DAYS: "${FX_MAX_RATE_AGE_DAYS:-}"
      # --- spend ---
      MONTHLY_SPEND_CAP_PENCE: "${MONTHLY_SPEND_CAP_PENCE:-}"
      GLOBAL_BILLING_DAY: "${GLOBAL_BILLING_DAY:-}"
      SOFT_CONFIRM_PENCE: "${SOFT_CONFIRM_PENCE:-}"
      EXECUTION_MAX_CALLS: "${EXECUTION_MAX_CALLS:-}"
      EXECUTION_MAX_FREE_CALLS: "${EXECUTION_MAX_FREE_CALLS:-}"
      EXECUTION_MAX_COST_PENCE: "${EXECUTION_MAX_COST_PENCE:-}"
      CHILD_MAX_CALLS: "${CHILD_MAX_CALLS:-}"
      # --- travelpayouts ---
      TRAVELPAYOUTS_TOKEN: "${TRAVELPAYOUTS_TOKEN:-}"
      TRAVELPAYOUTS_BILLING_DAY: "${TRAVELPAYOUTS_BILLING_DAY:-}"
      TRAVELPAYOUTS_MONTHLY_CALL_CAP: "${TRAVELPAYOUTS_MONTHLY_CALL_CAP:-}"
      TRAVELPAYOUTS_RATE_PER_MINUTE: "${TRAVELPAYOUTS_RATE_PER_MINUTE:-}"
      TRAVELPAYOUTS_RATE_PER_HOUR: "${TRAVELPAYOUTS_RATE_PER_HOUR:-}"
      TRAVELPAYOUTS_CONCURRENCY: "${TRAVELPAYOUTS_CONCURRENCY:-}"
      TRAVELPAYOUTS_CACHE_TTL_HOURS: "${TRAVELPAYOUTS_CACHE_TTL_HOURS:-}"
      # --- searchapi ---
      SEARCHAPI_KEY: "${SEARCHAPI_KEY:-}"
      SEARCHAPI_PLAN: "${SEARCHAPI_PLAN:-}"
      SEARCHAPI_BILLING_DAY: "${SEARCHAPI_BILLING_DAY:-}"
      SEARCHAPI_CACHE_TTL_HOURS: "${SEARCHAPI_CACHE_TTL_HOURS:-}"
      SEARCHAPI_TRIAL_USED: "${SEARCHAPI_TRIAL_USED:-}"
      SEARCHAPI_MONTHLY_CALL_CAP: "${SEARCHAPI_MONTHLY_CALL_CAP:-}"
      SEARCHAPI_RATE_PER_MINUTE: "${SEARCHAPI_RATE_PER_MINUTE:-}"
      SEARCHAPI_RATE_PER_HOUR: "${SEARCHAPI_RATE_PER_HOUR:-}"
      SEARCHAPI_CONCURRENCY: "${SEARCHAPI_CONCURRENCY:-}"
      SEARCHAPI_COST_PER_CALL_MICRO_GBP: "${SEARCHAPI_COST_PER_CALL_MICRO_GBP:-}"
      SEARCHAPI_PLAN_FIXED_PENCE: "${SEARCHAPI_PLAN_FIXED_PENCE:-}"
      # --- email (all or nothing) ---
      SMTP_HOST: "${SMTP_HOST:-}"
      SMTP_PORT: "${SMTP_PORT:-}"
      SMTP_TLS: "${SMTP_TLS:-}"
      SMTP_USER: "${SMTP_USER:-}"
      SMTP_PASS: "${SMTP_PASS:-}"
      ALERT_EMAIL_TO: "${ALERT_EMAIL_TO:-}"
      ALERT_EMAIL_FROM: "${ALERT_EMAIL_FROM:-}"
      ALERT_EMAIL_MAX_PER_HOUR: "${ALERT_EMAIL_MAX_PER_HOUR:-}"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  # Local mail catcher for host-side development only: `docker compose --profile dev up -d mailpit`.
  # why: spec §13: it serves the host-side `pnpm dev` process (SMTP_HOST=127.0.0.1, SMTP_PORT=1025,
  # SMTP_TLS=none). The app container runs with NODE_ENV=production, under which config accepts SMTP_TLS=none
  # only for a loopback host, so it always uses real SMTP and does not depend on this service.
  mailpit:
    image: axllent/mailpit@sha256:94f6b70c1436defae6799d9ac7ff0eeff9540465b842026d5cdb018f1c0234ea
    profiles: ["dev"]
    ports:
      - "127.0.0.1:1025:1025"
      - "127.0.0.1:8025:8025"

volumes:
  gmt-data: {}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/compose.test.ts && docker compose --env-file /dev/null config --quiet`
Expected: PASS (11 tests); `config --quiet` prints nothing and exits 0. (`--env-file /dev/null` keeps any real `.env` out of the check; never run `docker compose config` without `--quiet` against a real `.env`, because it prints the interpolated values.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/api/package.json pnpm-lock.yaml apps/api/test/deploy/compose.test.ts && git commit -m "wp12: compose with interpolated environment allowlist, auth always on, read-only hardened app, host-dev mailpit"
```

### Task 12.4: `scripts/backup.mjs` and `scripts/check-backup.mjs` over the bootstraps' own rules

**Files:**
- Create: `scripts/backup.mjs`, `scripts/check-backup.mjs`
- Test: `scripts/backup.test.mjs`, `apps/api/test/deploy/backupCli.test.ts`

**Interfaces:**
- Consumes: `backupDatabase` (WP3, built `@gmt/db`), `systemClock` (built `@gmt/core`), `EXIT` (`apps/api/dist/tools/types.js`), `backupsDirFor`, `BACKUPS_KEPT` (`apps/api/dist/bootstrap/preflight.js`), better-sqlite3 resolved from `packages/db`.
- Produces: the two CLIs of §5.

Rules (decision 32; reviews arch-wp12-r1-001, -007, -008, devops-006): the CLIs keep no copy of a rule: exit codes, the backups directory and the keep count come from apps/api's build, and the database path is realpath-resolved as the config resolves it, with no default other than `DATABASE_PATH`. A missing build is a setup fault (1), never a failed backup (74). The script tests cover only what the CLIs own; modes, refuse-existing, the world-writable refusal and pruning stay WP3's. The type-checked drift guard ties the behaviour to the source values.

- [ ] **Step 1: Write the failing tests**

`scripts/backup.test.mjs`:

```js
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// why: decision 49 keeps tests of root scripts beside them, run by the root Vitest project `scripts`. These test only
// what the two CLIs own: arguments, the one output line, the defaults, forwarding --keep, and mapping a failure to an
// exit code. VACUUM INTO, integrity_check, the 0700/0600 modes, refuse-existing, the world-writable refusal and
// pruning are WP3's backupDatabase and are tested there (review arch-wp12-r1-007).
const REPO = fileURLToPath(new URL('../', import.meta.url));
const NAME = /^get-me-there-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;
const Database = createRequire(join(REPO, 'packages', 'db', 'package.json'))('better-sqlite3');

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// why: both CLIs load the built packages and apps/api's build (as they do in the image), so those are built first.
beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
}, 300_000);

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'gmt-backup-cli-'));
  dirs.push(d);
  return d;
}

/** A small WAL database standing in for /data/get-me-there.db. @param {string} dir */
function sampleDb(dir) {
  const path = join(dir, 'get-me-there.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (x INTEGER NOT NULL); INSERT INTO t (x) VALUES (42);');
  db.close();
  return path;
}

/** @param {string} script @param {string[]} args @param {Record<string, string>} [env] */
function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}
const backup = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ env = {}) =>
  run(join(REPO, 'scripts', 'backup.mjs'), args, env);
const check = (/** @type {string[]} */ args) => run(join(REPO, 'scripts', 'check-backup.mjs'), args);

/** @param {string} dir */
function backups(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => NAME.test(f)) : [];
}

describe('scripts/backup.mjs (spec §13 Backup; the plan’s exit-code table)', () => {
  it('exits 0 and prints exactly one JSON line naming a copy that holds the data', () => {
    const dir = tempDir();
    const r = backup(['--db', sampleDb(dir), '--dir', join(dir, 'b')]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    const copy = new Database(out.file, { readonly: true });
    expect(copy.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
    copy.close();
  });

  it('defaults to DATABASE_PATH, resolved like the config, and the backups folder beside the real file', () => {
    const dir = tempDir();
    const real = sampleDb(dir);
    const linkDir = join(tempDir(), 'link');
    mkdirSync(linkDir);
    symlinkSync(real, join(linkDir, 'get-me-there.db'));
    const r = backup([], { DATABASE_PATH: join(linkDir, 'get-me-there.db') });
    expect(r.status).toBe(0);
    expect(backups(join(realpathSync(dir), 'backups'))).toHaveLength(1);
    expect(backups(join(linkDir, 'backups'))).toHaveLength(0);
  });

  it('forwards --keep to the routine', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    for (let i = 0; i < 2; i++) expect(backup(['--db', db]).status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(2);
    expect(backup(['--db', db, '--keep', '1']).status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(1);
  });

  it('exits 74 with the routine’s cause when the backup fails', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    writeFileSync(db, 'this is not a database file '.repeat(200));
    const r = backup(['--db', db]);
    expect(r.status).toBe(74);
    expect(r.stderr).toMatch(/^backup failed: .*file is not a database/);
  });

  it.each([
    [[], 'DATABASE_PATH is required'],
    [['--force'], 'unknown argument --force'],
    [['--db'], '--db needs a value'],
    [['--db', 'a', '--keep', '0'], '--keep must be a positive integer'],
    [['--db', 'a', '--keep', 'two'], '--keep must be a positive integer'],
    [['--db', 'a', '--db', 'b'], '--db is given twice'],
  ])('exits 64 on bad arguments %j', (args, reason) => {
    const r = backup(args);
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/^usage: node scripts\/backup\.mjs/);
    expect(r.stderr).toContain(reason);
    expect(r.stdout).toBe('');
  });

  it('exits 1 naming the build when the built packages are missing, never 74', () => {
    const fake = tempDir();
    mkdirSync(join(fake, 'scripts'));
    mkdirSync(join(fake, 'apps', 'api'), { recursive: true });
    writeFileSync(join(fake, 'apps', 'api', 'package.json'), '{"name":"@gmt/api","type":"module"}');
    copyFileSync(join(REPO, 'scripts', 'backup.mjs'), join(fake, 'scripts', 'backup.mjs'));
    const r = run(join(fake, 'scripts', 'backup.mjs'), ['--db', join(fake, 'x.db')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^backup: cannot load the built packages \(run pnpm build\)/);
  });
});

describe('scripts/check-backup.mjs (spec §13 Restore)', () => {
  it('exits 0 for a good backup', () => {
    const dir = tempDir();
    const made = JSON.parse(backup(['--db', sampleDb(dir)]).stdout);
    const r = check([made.file]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, file: made.file });
  });

  it('exits 74 for a file that is not a database or does not exist', () => {
    const dir = tempDir();
    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'not a database '.repeat(200));
    for (const f of [bad, join(dir, 'absent.db')]) {
      const r = check([f]);
      expect(r.status).toBe(74);
      expect(r.stderr).toMatch(/^backup check failed: /);
    }
  });

  it('exits 64 without exactly one file argument', () => {
    for (const args of [[], ['a', 'b'], ['--help']]) expect(check(args).status).toBe(64);
  });
});
```

`apps/api/test/deploy/backupCli.test.ts`:

```ts
// Drift guard (review arch-wp12-r1-001): scripts/backup.mjs and scripts/check-backup.mjs hold no rule of their own;
// they load EXIT, BACKUPS_KEPT and backupsDirFor from apps/api's build. This type-checked test ties their behaviour
// to the source values, so a stale build or a local copy of a rule fails here.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '@gmt/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, backupsDirFor } from '../../src/bootstrap/preflight.js';
import { EXIT } from '../../src/tools/types.js';
import { tempDir } from '../helpers/tmp.js';
import { REPO } from './files.js';

beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
}, 300_000);

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(REPO, 'scripts', script), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

describe('the backup CLIs follow apps/api’s rules (plan decision 32, the single exit-code table)', () => {
  it('backs up into backupsDirFor(DATABASE_PATH) and keeps BACKUPS_KEPT by default', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    // why: apps/api never imports better-sqlite3 (decision 23); @gmt/db opens the file
    const d = openDatabase(db);
    d.raw.exec('CREATE TABLE t (x INTEGER)');
    d.close();
    for (let i = 0; i <= BACKUPS_KEPT; i++)
      expect(run('backup.mjs', [], { DATABASE_PATH: db }).status).toBe(EXIT.ok);
    expect(readdirSync(backupsDirFor(db))).toHaveLength(BACKUPS_KEPT);
  });

  it('maps usage and failures to EXIT.usage and EXIT.backupFailed', () => {
    const dir = tempDir();
    expect(run('backup.mjs', ['--db', join(dir, 'x.db'), '--keep', '0']).status).toBe(EXIT.usage);
    expect(run('backup.mjs', ['--db', join(dir, 'absent.db')]).status).toBe(EXIT.backupFailed);
    expect(run('check-backup.mjs', []).status).toBe(EXIT.usage);
    writeFileSync(join(dir, 'bad.db'), 'not a database '.repeat(200));
    expect(run('check-backup.mjs', [join(dir, 'bad.db')]).status).toBe(EXIT.backupFailed);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run --project scripts backup && pnpm --filter @gmt/api exec vitest run test/deploy/backupCli.test.ts`
Expected: FAIL in all 14 script tests and both guard tests: each spawn exits 1 with `Cannot find module '…/scripts/backup.mjs'` (or `check-backup.mjs`).

- [ ] **Step 3: Implement**

`scripts/backup.mjs`:

```js
#!/usr/bin/env node
// On-demand SQLite backup for get-me-there. Spec §13 "Backup".
//   docker compose exec -T app node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n>]
// A thin wrapper over the built packages, holding no rule of its own: the routine is @gmt/db `backupDatabase` (WP3),
// and the exit codes (`EXIT`), the backups directory (`backupsDirFor`) and the keep count (`BACKUPS_KEPT`) are the ones
// both bootstraps use, imported from apps/api's build (plan decision 32). Run it as the app's user (the image's
// `node`), never as root (plan decision 26).
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n ≥ 1>]';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The built modules, through apps/api's dependency links (present after `pnpm build` and in the image). why: scripts/
 * is not a workspace package, so a bare import would not resolve.
 */
async function load() {
  const api = new URL('../apps/api/', import.meta.url);
  const requireFromApi = createRequire(new URL('package.json', api));
  const imp = (/** @type {string} */ p) => import(pathToFileURL(p).href);
  const [db, core, types, preflight] = await Promise.all([
    imp(requireFromApi.resolve('@gmt/db')),
    imp(requireFromApi.resolve('@gmt/core')),
    import(new URL('dist/tools/types.js', api).href),
    import(new URL('dist/bootstrap/preflight.js', api).href),
  ]);
  return {
    backupDatabase: db.backupDatabase,
    systemClock: core.systemClock,
    EXIT: types.EXIT,
    backupsDirFor: preflight.backupsDirFor,
    BACKUPS_KEPT: preflight.BACKUPS_KEPT,
  };
}

/**
 * @param {string[]} argv
 * @param {string | undefined} envDb
 * @param {{ backupsDirFor: (db: string) => string; BACKUPS_KEPT: number }} rules
 * @returns {{ ok: true; db: string; dir: string; keep: number } | { ok: false; reason: string }}
 */
function parseArgs(argv, envDb, rules) {
  /** @type {Map<string, string>} */
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] ?? '';
    const value = argv[i + 1];
    if (!['--db', '--dir', '--keep'].includes(name)) return { ok: false, reason: `unknown argument ${name}` };
    if (flags.has(name)) return { ok: false, reason: `${name} is given twice` };
    if (value === undefined || value === '' || value.startsWith('--'))
      return { ok: false, reason: `${name} needs a value` };
    flags.set(name, value);
  }
  const keepRaw = flags.get('--keep') ?? String(rules.BACKUPS_KEPT);
  const keep = Number(keepRaw);
  if (!/^\d+$/.test(keepRaw) || !Number.isSafeInteger(keep) || keep < 1)
    return { ok: false, reason: `--keep must be a positive integer, got ${keepRaw}` };
  const given = flags.get('--db') ?? (envDb === undefined || envDb === '' ? undefined : envDb);
  // why: like the config, the CLI has no default database; compose sets DATABASE_PATH for the container.
  if (given === undefined) return { ok: false, reason: '--db or DATABASE_PATH is required' };
  // why: the bootstraps resolve DATABASE_PATH with realpath before deriving the backups directory, so a symlinked
  // path backs up beside the real file here too; a missing file is reported by backupDatabase itself.
  const db = existsSync(given) ? realpathSync(given) : given;
  return { ok: true, db, dir: flags.get('--dir') ?? rules.backupsDirFor(db), keep };
}

async function main() {
  let mods;
  try {
    mods = await load();
  } catch (err) {
    // why: a setup fault, not a failed backup; 1 is the table's "a tool run failed" (EXIT itself did not load).
    process.stderr.write(`backup: cannot load the built packages (run pnpm build): ${message(err)}\n`);
    return 1;
  }
  const args = parseArgs(process.argv.slice(2), process.env.DATABASE_PATH, mods);
  if (!args.ok) {
    process.stderr.write(`${USAGE}\n${args.reason}\n`);
    return mods.EXIT.usage;
  }
  try {
    const r = mods.backupDatabase(args.db, args.dir, { keep: args.keep, clock: mods.systemClock });
    process.stdout.write(`${JSON.stringify({ ok: true, file: r.file })}\n`);
    return mods.EXIT.ok;
  } catch (err) {
    process.stderr.write(`backup failed: ${message(err)}\n`);
    return mods.EXIT.backupFailed;
  }
}

process.exitCode = await main();
```

`scripts/check-backup.mjs`:

```js
#!/usr/bin/env node
// Checks a backup before a restore (spec §13 Restore; docs/setup.md section 6): opens the file read-only and runs
// SQLite's `PRAGMA integrity_check`, the check backupDatabase runs on every copy it writes.
//   node scripts/check-backup.mjs <file>
// Exit codes from the plan's single table (apps/api EXIT): 0 ok, 64 usage, 74 the backup is unusable; 1 when the
// built packages cannot be loaded.
import { createRequire } from 'node:module';

const USAGE = 'usage: node scripts/check-backup.mjs <backup file>';

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  let EXIT;
  let Database;
  try {
    ({ EXIT } = await import(new URL('../apps/api/dist/tools/types.js', import.meta.url).href));
    // why: resolve from packages/db, the one workspace package that depends on better-sqlite3 (as the prebuilt check).
    Database = createRequire(new URL('../packages/db/package.json', import.meta.url))('better-sqlite3');
  } catch (err) {
    process.stderr.write(`check-backup: cannot load the built packages (run pnpm build): ${message(err)}\n`);
    return 1;
  }
  const args = process.argv.slice(2);
  const file = args[0];
  if (args.length !== 1 || file === undefined || file === '' || file.startsWith('--')) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    let verdict;
    try {
      verdict = String(db.pragma('integrity_check', { simple: true }));
    } finally {
      db.close();
    }
    if (verdict !== 'ok') throw new Error(`integrity_check returned ${verdict}`);
    process.stdout.write(`${JSON.stringify({ ok: true, file })}\n`);
    return EXIT.ok;
  } catch (err) {
    process.stderr.write(`backup check failed: ${message(err)}\n`);
    return EXIT.backupFailed;
  }
}

process.exitCode = await main();
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run --project scripts backup && pnpm --filter @gmt/api exec vitest run test/deploy/backupCli.test.ts`
Expected: PASS: 14 script tests (11 backup: 5 behaviours and 6 bad-argument cases; 3 check-backup) and 2 guard tests. The first run builds `@gmt/api` and its dependencies (about a minute).

- [ ] **Step 5: Commit**

```bash
git add scripts/backup.mjs scripts/check-backup.mjs scripts/backup.test.mjs apps/api/test/deploy/backupCli.test.ts && git commit -m "wp12: backup and backup-check CLIs over the bootstraps' exit codes, directory and keep count"
```

### Task 12.5: `docs/api-limits.md` with the generated preset table

**Files:**
- Create: `docs/api-limits.md`
- Test: `apps/api/test/deploy/presetTable.ts`, `apps/api/test/deploy/apiLimits.test.ts`

**Interfaces:**
- Consumes: `PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`, `microGbpToPence`, `PlanPreset` (WP0), `ALL_VARS` (WP4b).
- Produces: `ROWS`, `renderPresetTable()`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/deploy/presetTable.ts`:

```ts
// The docs/api-limits.md preset table, rendered from core's PLAN_PRESETS and TRAVELPAYOUTS_DEFAULTS (spec §12: "the
// full preset table lives in docs/api-limits.md and the zod schema"), so the doc and the code cannot drift.
import { microGbpToPence, PLAN_PRESETS, type PlanPreset, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';

interface Row {
  field: keyof PlanPreset;
  unit: 'count' | 'text' | 'microGbp';
  overrides: readonly string[];
  planOnly: boolean;
}

/** One row per preset field, in display order, with the variables that override it (spec §12). */
export const ROWS: readonly Row[] = [
  {
    field: 'monthlyCallCap',
    unit: 'count',
    overrides: ['SEARCHAPI_MONTHLY_CALL_CAP', 'TRAVELPAYOUTS_MONTHLY_CALL_CAP'],
    planOnly: false,
  },
  { field: 'window', unit: 'text', overrides: [], planOnly: false },
  {
    field: 'billingDay',
    unit: 'count',
    overrides: ['SEARCHAPI_BILLING_DAY', 'TRAVELPAYOUTS_BILLING_DAY'],
    planOnly: false,
  },
  {
    field: 'ratePerMinute',
    unit: 'count',
    overrides: ['SEARCHAPI_RATE_PER_MINUTE', 'TRAVELPAYOUTS_RATE_PER_MINUTE'],
    planOnly: false,
  },
  {
    field: 'ratePerHour',
    unit: 'count',
    overrides: ['SEARCHAPI_RATE_PER_HOUR', 'TRAVELPAYOUTS_RATE_PER_HOUR'],
    planOnly: false,
  },
  {
    field: 'concurrency',
    unit: 'count',
    overrides: ['SEARCHAPI_CONCURRENCY', 'TRAVELPAYOUTS_CONCURRENCY'],
    planOnly: false,
  },
  {
    field: 'cacheTtlHours',
    unit: 'count',
    overrides: ['SEARCHAPI_CACHE_TTL_HOURS', 'TRAVELPAYOUTS_CACHE_TTL_HOURS'],
    planOnly: false,
  },
  {
    field: 'costPerCallMicroGbp',
    unit: 'microGbp',
    overrides: ['SEARCHAPI_COST_PER_CALL_MICRO_GBP'],
    planOnly: false,
  },
  {
    field: 'planFixedMicroGbp',
    unit: 'microGbp',
    overrides: ['SEARCHAPI_PLAN_FIXED_PENCE'],
    planOnly: false,
  },
  { field: 'excludedFromSchedule', unit: 'text', overrides: [], planOnly: false },
  {
    field: 'monthlySpendCapMicroGbp',
    unit: 'microGbp',
    overrides: ['MONTHLY_SPEND_CAP_PENCE'],
    planOnly: true,
  },
  { field: 'executionMaxCalls', unit: 'count', overrides: ['EXECUTION_MAX_CALLS'], planOnly: true },
  {
    field: 'executionMaxCostMicroGbp',
    unit: 'microGbp',
    overrides: ['EXECUTION_MAX_COST_PENCE'],
    planOnly: true,
  },
];

/** Travelpayouts' schema defaults by field name. why: a Map over its entries reads a field without a cast. */
const TP_DEFAULTS = new Map<string, unknown>(Object.entries(TRAVELPAYOUTS_DEFAULTS));

function cell(value: unknown, unit: Row['unit']): string {
  if (value === undefined) return '—';
  // why: core's one micro-GBP→pence conversion (decision 49), so the doc rounds as the app does
  if (unit === 'microGbp' && typeof value === 'number') return `${value} µGBP (${microGbpToPence(value)}p)`;
  return String(value);
}

/** The markdown table docs/api-limits.md carries between its preset-table markers. */
export function renderPresetTable(): string {
  const lines = [
    '| Field | Override variable | SearchApi `trial` | SearchApi `40usd` | Travelpayouts (schema defaults) |',
    '|---|---|---|---|---|',
  ];
  for (const r of ROWS) {
    const override =
      r.overrides.length > 0 ? r.overrides.map((v) => `\`${v}\``).join(' / ') : '— (fixed by plan)';
    const tp = r.planOnly ? undefined : TP_DEFAULTS.get(r.field);
    lines.push(
      `| \`${r.field}\` | ${override} | ${cell(PLAN_PRESETS.trial[r.field], r.unit)} | ${cell(PLAN_PRESETS['40usd'][r.field], r.unit)} | ${cell(tp, r.unit)} |`,
    );
  }
  return lines.join('\n');
}
```

`apps/api/test/deploy/apiLimits.test.ts`:

```ts
// Spec §12 and §13: docs/api-limits.md carries the full preset table, generated from the code.
import { PLAN_PRESETS, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ALL_VARS } from '../helpers/env.js';
import { between, read } from './files.js';
import { ROWS, renderPresetTable } from './presetTable.js';

describe('docs/api-limits.md preset table (spec §12)', () => {
  it('covers every preset field of every plan and every Travelpayouts default', () => {
    const fields = ROWS.map((r) => r.field).sort();
    expect(fields).toEqual(Object.keys(PLAN_PRESETS.trial).sort());
    expect(fields).toEqual(Object.keys(PLAN_PRESETS['40usd']).sort());
    for (const key of Object.keys(TRAVELPAYOUTS_DEFAULTS)) expect(fields).toContain(key);
  });

  it('names only override variables the config reads (WP4b ALL_VARS)', () => {
    const known: readonly string[] = ALL_VARS;
    for (const name of ROWS.flatMap((r) => r.overrides)) expect(known).toContain(name);
  });

  it('matches the table rendered from PLAN_PRESETS and TRAVELPAYOUTS_DEFAULTS', () => {
    const doc = between(
      read('docs/api-limits.md'),
      '<!-- preset-table:start -->\n',
      '\n<!-- preset-table:end -->',
    );
    expect(doc).toBe(renderPresetTable());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/apiLimits.test.ts`
Expected: the coverage and override-name tests PASS; "matches the table" FAILS with `ENOENT … docs/api-limits.md`.

- [ ] **Step 3: Implement**

`docs/api-limits.md`:

````markdown
# Provider limits, plan presets and reconciliation

Every limit below is enforced by the app before a request leaves the process: the ledger
(`provider_requests`) records each attempt, and a request that would cross a cap is refused
before it is sent. Configuration lives in `.env` (see `.env.example`); this page explains
what the values mean. Provider facts were measured on 2026-10-14 and 2026-10-15 and come from
`docs/providers.md`; vendors change plans, so re-check their pages before relying on a number.

## Plan presets

`SEARCHAPI_PLAN` selects a preset (`trial` by default, or `40usd`); Travelpayouts has one set of
schema defaults. Each individual variable overrides its preset value. Money is configured in
pence and held in micro-GBP (1p = 10,000 µGBP). This table is generated from the code
(`PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`) and a test fails if they drift apart.

<!-- preset-table:start -->
| Field | Override variable | SearchApi `trial` | SearchApi `40usd` | Travelpayouts (schema defaults) |
|---|---|---|---|---|
| `monthlyCallCap` | `SEARCHAPI_MONTHLY_CALL_CAP` / `TRAVELPAYOUTS_MONTHLY_CALL_CAP` | 100 | 10000 | 50000 |
| `window` | — (fixed by plan) | lifetime | month | month |
| `billingDay` | `SEARCHAPI_BILLING_DAY` / `TRAVELPAYOUTS_BILLING_DAY` | 1 | 1 | 1 |
| `ratePerMinute` | `SEARCHAPI_RATE_PER_MINUTE` / `TRAVELPAYOUTS_RATE_PER_MINUTE` | 2 | 10 | 200 |
| `ratePerHour` | `SEARCHAPI_RATE_PER_HOUR` / `TRAVELPAYOUTS_RATE_PER_HOUR` | 20 | 2000 | 10000 |
| `concurrency` | `SEARCHAPI_CONCURRENCY` / `TRAVELPAYOUTS_CONCURRENCY` | 1 | 2 | 4 |
| `cacheTtlHours` | `SEARCHAPI_CACHE_TTL_HOURS` / `TRAVELPAYOUTS_CACHE_TTL_HOURS` | 1 | 1 | 6 |
| `costPerCallMicroGbp` | `SEARCHAPI_COST_PER_CALL_MICRO_GBP` | 0 µGBP (0p) | 0 µGBP (0p) | 0 µGBP (0p) |
| `planFixedMicroGbp` | `SEARCHAPI_PLAN_FIXED_PENCE` | 0 µGBP (0p) | 32000000 µGBP (3200p) | 0 µGBP (0p) |
| `excludedFromSchedule` | — (fixed by plan) | true | false | false |
| `monthlySpendCapMicroGbp` | `MONTHLY_SPEND_CAP_PENCE` | 0 µGBP (0p) | 35000000 µGBP (3500p) | — |
| `executionMaxCalls` | `EXECUTION_MAX_CALLS` | 0 | 2000 | — |
| `executionMaxCostMicroGbp` | `EXECUTION_MAX_COST_PENCE` | 0 µGBP (0p) | 0 µGBP (0p) | — |
<!-- preset-table:end -->

How to read it:

- **`trial`** is SearchApi's one-off allowance of 100 credits. The window is the lifetime of
  the install, not a month, and scheduled runs leave SearchApi out; use it for the smoke test
  only. If some credits were spent elsewhere, set `SEARCHAPI_TRIAL_USED` to the number used
  (100 minus the dashboard's "Remaining free searches (credits)").
- **`40usd`** is the subscription. Each call costs 0 at the margin; the fee (£32, entered as
  3200p) is counted once in the global monthly cap, which defaults to 3500p, so
  `MONTHLY_SPEND_CAP_PENCE` reads as total monthly spend. The 10,000-call cap is the hard
  stop. The hourly rate of 2,000 is the vendor's "20% of the plan per hour" rule.
- **Travelpayouts** is free and never billed; its call cap only bounds load. The vendor allows
  600 requests a minute on this endpoint; the app defaults to 200.
- `EXECUTION_MAX_FREE_CALLS` (default 2000), `SOFT_CONFIRM_PENCE` (100) and
  `CHILD_MAX_CALLS` (6) are not plan-dependent and are not in the table.
- A billed provider enabled under a spend cap of 0 makes boot log a warning, and the Providers
  page says verification will not run.
- `docs/scheduling.md` turns these caps into calls a run and a month for the worked example.

## Budget windows

Each provider's month starts on its `<PROVIDER>_BILLING_DAY` (UTC, 1–28, so every month has
the day); the global month starts on `GLOBAL_BILLING_DAY` (UTC, default 1). Set SearchApi's
billing day to the day your subscription renews so the app's month and the vendor's month
line up. `trial` uses a lifetime window. The Providers page and `GET /api/budget` show every
window's start and end with calls and cost so far.

## Per-provider facts

### Travelpayouts (Aviasales Data API): authorised, cached, free

- Endpoint `/aviasales/v3/prices_for_dates`, one logical request per (origin airport,
  destination airport, month) with `departure_at=YYYY-MM`, `one_way=false`, `currency=gbp`,
  up to 1000 rows a page and at most 3 pages a tile. The app never sends a city (metro) code:
  a metro query returns one cheapest row per date pair across every airport of the city, so a
  cheaper airport you did not choose would hide your own airport's fare. The worked example
  (2 origins, 2 destinations, 7 departure months) is 28 free calls a scan.
- Prices are Aviasales users' own recent searches. Each row's link carries the day the fare
  was found, which the app shows as its age; the vendor's declared 48-hour horizon is the
  fallback when that day is missing. The app labels these prices "Aviasales cache".
- The vendor ignores `market` (point of sale is recorded as unknown) and `trip_class`
  (economy only; other cabins return no data with a note).
- Coverage depends on what users searched: a thin long-haul route measured zero cached rows
  over eight months, busy gateways four to six a month. Run the coverage check on the
  Definitions form before relying on it.
- The token travels in the `X-Access-Token` header, never in a URL.

### SearchApi (Google Flights engines): scraping-derived, opt-in

- SearchApi obtains Google's results in a way Google's terms prohibit; the app uses it because
  the operator opted in (decision 2026-10-14) and labels its prices "Google date grid via
  SearchApi" (calendar) and "Google Flights via SearchApi" (itinerary search).
- `google_flights_calendar` (discovery): at most 200 date combinations per call (HTTP 400
  above that), one airport per side (city codes are rejected), 9 to 29 seconds per call. The
  app tiles 8 outbound days by the return span the nights band needs, 21 calls per airport pair
  for the worked example's 182-day window and 10–21 nights, 84 for its 4 pairs.
- `google_flights` (verification): three steps per cell, `1 + expandTop × 2` calls, 5 at the
  default `expandTop` of 2. Step 3 can show an online agency below the airline's fare, so it
  always runs. Some options carry no price and are skipped.
- Billing: only HTTP 200 responses count; error responses are not billed, and a repeat answered
  from the vendor's cache was not billed either (dashboard, 2026-10-14). The app's ledger counts
  every HTTP 200 attempt, so it can read higher than the dashboard, never lower.
- The key travels in an `Authorization: Bearer` header, never in a URL.

## Reconciling with the vendor dashboard

Once a week (or before raising a cap), compare the app with SearchApi's dashboard:

1. Open the Providers page (or `GET /api/budget`) and note SearchApi's calls in the current
   window and the window's start date.
2. Open SearchApi's dashboard and note the searches used in the same billing period
   (on `trial`, 100 minus "Remaining free searches (credits)").
3. Expect **app ≥ dashboard**. The gap is cached repeats and retries the vendor did not bill.
4. If the **dashboard is higher**, something outside this install used the key, or the
   database was restored from a backup (below). Lower `SEARCHAPI_MONTHLY_CALL_CAP` to
   `10000 − dashboard used` (or raise `SEARCHAPI_TRIAL_USED` on `trial`) in `.env` and run
   `docker compose up -d` until the next billing day.
5. Travelpayouts is free; there is nothing to reconcile, only the call counts on the
   Providers page.

## Restoring a backup resets month-to-date spend

The ledger lives in the database. Restoring a backup removes every ledger row written after
that backup, so the app believes fewer calls were made this month than the vendor counted.
After any restore, before the next run: read the dashboard, lower
`SEARCHAPI_MONTHLY_CALL_CAP` (or raise `SEARCHAPI_TRIAL_USED`) by the difference as in step 4
above, and put the cap back after the next billing day. The restore steps are in
`docs/setup.md`.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/apiLimits.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add docs/api-limits.md apps/api/test/deploy && git commit -m "wp12: api-limits doc with the preset table generated from PLAN_PRESETS"
```

### Task 12.6: `docs/scheduling.md` with the cadence table generated from the engine

**Files:**
- Create: `docs/scheduling.md`, `docs/examples/london-new-york.json`
- Test: `apps/api/test/deploy/cadence.ts`, `apps/api/test/deploy/scheduling.test.ts`

**Interfaces:**
- Consumes: `seededPorts` (WP4b test helper), `createEngine` → `estimate`, `budgetFit` (WP7), `definitionCreateRequestSchema`, `fixedClock`, `asIsoDate`, `asIsoDateTime` (WP0).
- Produces: `CADENCE_DAY`, `exampleInput()`, `cadenceCases()`, `renderCadenceTable()`; the example JSON.

Rule (spec §8.2, decisions 25, 34, 62): every number in the table is the engine's: calls a run are `Estimate.perProvider[].planCalls` and `.calls` (with the retry factor), runs a month `BudgetFit.runsPerMonth` unrounded (shown to two places), calls a month the `provider-*` scopes of `budgetFit` (which count a calendar fetch once per refresh period), a provider absent from those scopes is shown as left out of scheduled runs, and `Fits` is `budgetFit.fits`. The engine runs over WP4b's `seededPorts` (sentinel credentials, in-memory database) on a fixed day, so the table is deterministic and makes no network call; `seededPorts`' raised rate limits change only the estimate's seconds, which the table does not show.

- [ ] **Step 1: The example definition**

`docs/examples/london-new-york.json` (WP9 may already have written these exact bytes as a stand-in):

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

`// why:` the example carries the recommended `40usd` configuration (both providers) because that is what the spec §11 defaults describe; `docs/setup.md` gives the one-block change for £0. The budget block equals the `40usd` preset (`EXECUTION_MAX_CALLS` 2000, `EXECUTION_MAX_FREE_CALLS` 2000, `EXECUTION_MAX_COST_PENCE` 0).

- [ ] **Step 2: Write the failing test**

`apps/api/test/deploy/cadence.ts`:

```ts
// The docs/scheduling.md cadence table, computed by the engine's own estimate and budgetFit (spec §8.2: "from the
// same functions as the estimate"), so the operator's numbers and the app's cap checks cannot drift apart.
// Travelpayouts plans one tile per (origin airport, destination airport, month), never a metro query (decision 34);
// runsPerMonth is the engine's, unrounded (firings in the next 365 days ÷ 12, decision 25).
import { apiContract, asIsoDate, asIsoDateTime, type DefinitionInput, fixedClock } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { seededPorts } from '../helpers/recording.js';
import { read } from './files.js';

/**
 * The day the table is computed for. why: a relative window spans 7 or 8 calendar months depending on the day it is
 * resolved, and Travelpayouts plans a tile per pair and month, so the doc names the day.
 */
export const CADENCE_DAY = '2026-10-14';

/** The importable example (docs/examples/london-new-york.json) parsed by the create schema, as the engine takes it. */
export function exampleInput(): DefinitionInput {
  return apiContract.definitionCreateRequestSchema.parse(
    JSON.parse(read('docs/examples/london-new-york.json')),
  );
}

export interface CadenceCase {
  label: string;
  plan: 'none' | 'trial' | '40usd';
  definition: DefinitionInput;
}

/** The table's rows: the £0 configuration, the example on $40 weekly and daily, its maxCells headroom, the trial. */
export function cadenceCases(): CadenceCase[] {
  const example = exampleInput();
  const free: DefinitionInput = {
    ...example,
    providers: {
      discovery: ['travelpayouts'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168 },
    },
  };
  return [
    { label: '£0: Travelpayouts only, weekly', plan: 'none', definition: free },
    { label: '$40: both providers, weekly (the example)', plan: '40usd', definition: example },
    {
      label: '$40: both providers, daily (`0 5 * * *`)',
      plan: '40usd',
      definition: { ...example, scheduleCron: '0 5 * * *' },
    },
    {
      label: '$40: both providers, weekly, `maxCells` 200',
      plan: '40usd',
      definition: { ...example, verification: { ...example.verification, maxCells: 200 } },
    },
    { label: 'SearchApi `trial`: both providers, weekly', plan: 'trial', definition: example },
  ];
}

const PROVIDER_LABEL = new Map<string, string>([
  ['travelpayouts', 'Travelpayouts'],
  ['searchapi', 'SearchApi'],
]);
const label = (id: string): string => PROVIDER_LABEL.get(id) ?? id;

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One case through a real engine over in-memory ports, as the Definitions form's estimate and budget fit are made. */
function computeRow(c: CadenceCase): { cells: string[]; retryFactor: number } {
  // why: WP4b's seededPorts (both providers on sentinel credentials, airports seeded, closed after the test); its
  // raised rate limits change only the estimate's seconds, never its calls or any cap, so the table is the default one.
  const ports = seededPorts(
    c.plan === 'none' ? { SEARCHAPI_KEY: '' } : { SEARCHAPI_PLAN: c.plan },
    fixedClock(asIsoDateTime(`${CADENCE_DAY}T09:00:00.000Z`)),
  );
  const engine = createEngine({ ...ports, notifiers: [] });
  const est = engine.estimate(c.definition, asIsoDate(CADENCE_DAY));
  const fit = engine.budgetFit(c.definition);
  const perRun = est.perProvider.map((p) => {
    const stage = p.stage === 'discovery' ? 'calendar' : 'itinerary search';
    const blocked = p.blocked === null ? '' : ` (refused: over the ${p.blocked} cap)`;
    return `${label(p.providerId)} ${stage} ${thousands(p.planCalls)} → ${thousands(p.calls)}${blocked}`;
  });
  const scopes = new Map(
    fit.perScope
      .filter((s) => s.scope.startsWith('provider-'))
      .map((s) => [s.scope.slice(s.scope.indexOf(':') + 1), s] as const),
  );
  const providers = [...new Set(est.perProvider.map((p) => p.providerId))];
  const monthly = providers.map((id) => {
    const s = scopes.get(id);
    if (s === undefined) return `${label(id)} 0 (scheduled runs leave it out)`;
    return `${label(id)} ${thousands(s.estimated)} of ${s.cap === null ? 'no cap' : thousands(s.cap)}`;
  });
  return {
    cells: [
      c.label,
      perRun.join('; '),
      fit.runsPerMonth.toFixed(2),
      monthly.join('; '),
      fit.fits ? 'yes' : 'no',
    ],
    retryFactor: est.retryFactor,
  };
}

/** The markdown table docs/scheduling.md carries between its cadence-table markers. */
export function renderCadenceTable(): string {
  const rows = cadenceCases().map(computeRow);
  const factor = rows[0]?.retryFactor ?? 1;
  return [
    `| Configuration | Calls a run: planned → with the ${factor} retry factor | Runs a month | Calls a month (budgetFit) of the cap | Fits every cap |`,
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.cells.join(' | ')} |`),
  ].join('\n');
}
```

`apps/api/test/deploy/scheduling.test.ts`:

```ts
// Spec §8.2 cadence arithmetic: docs/scheduling.md's table is generated from the engine's estimate and budgetFit.
import { describe, expect, it } from 'vitest';
import { renderCadenceTable } from './cadence.js';
import { between, read } from './files.js';

describe('docs/scheduling.md cadence table (spec §8.2; decisions 25, 34)', () => {
  it('matches the table the engine computes for the example on the day the doc names', () => {
    const doc = read('docs/scheduling.md');
    expect(doc.replace(/\s+/g, ' ')).toContain('computed for a definition saved on 14 October 2026');
    const table = between(doc, '<!-- cadence-table:start -->\n', '\n<!-- cadence-table:end -->');
    expect(table).toBe(renderCadenceTable());
  }, 60_000);

  it('Travelpayouts plans one free call per airport pair and month (2 × 2 pairs × 7 months), and runs a month stay unrounded', () => {
    const table = renderCadenceTable();
    expect(table).toContain('| £0: Travelpayouts only, weekly | Travelpayouts calendar 28 → 34 | 4.33 |');
    expect(table).toContain('| $40: both providers, daily (`0 5 * * *`) |');
    expect(table).toContain('| 30.42 |');
  }, 60_000);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/scheduling.test.ts`
Expected: "matches the table" FAILS with `ENOENT … docs/scheduling.md`; the second test PASSES (it reads only the engine).

- [ ] **Step 4: Implement**

`docs/scheduling.md`:

````markdown
# Scheduling

A definition with a schedule runs on its own; the app has one in-process scheduler and needs
no host cron for searches. Times are evaluated in the definition's time zone (`scheduleTz`,
which new definitions take from `SCHEDULER_TIMEZONE`, default `Europe/London`), so 05:00 stays
05:00 local across the clock changes.

## Cron examples

Five fields: minute, hour, day of month, month, day of week. The minute must be a single
number, so a schedule runs at most once an hour; anything more frequent is rejected when you
save.

| Cron | Meaning |
|---|---|
| `0 5 * * 1` | Mondays 05:00 (the default) |
| `0 5 * * 1,4` | Mondays and Thursdays 05:00 |
| `0 5 * * *` | every day 05:00 |
| `30 6 1,15 * *` | the 1st and 15th of the month 06:30 |

Avoid 01:00–02:59 in `Europe/London`: on the March change that hour does not exist and on
the October change it happens twice. Pick an hour outside it.

The definition's `discoveryRefreshHours` (default 168, one week) decides when a calendar price
is old enough to fetch again. A price younger than 90% of it is reused rather than refetched,
so a weekly schedule refreshes weekly, and a daily schedule under a 168-hour refresh fetches
calendars about five times a month and reuses them in between; itinerary search runs on every
firing. Lower `discoveryRefreshHours` to refresh calendars more often.

## Cadence and the call budget

The table below is computed by the app's own estimate and budget-fit functions, the ones the
Definitions form shows, for the worked example (London → New York: 2 origins × 2 destinations,
departures from 7 days ahead over 182 days, 10–21 nights). It was computed for a definition
saved on 14 October 2026: a window that spans a different number of calendar months plans a
different number of Travelpayouts calls, so the form's estimate is the figure for your own
definition. "Planned" is the call plan; the app reserves budget for it times the retry
factor. "Runs a month" is the number of firings in the next 365 days divided by 12, not
rounded. "Calls a month" is what the budget fit compares with each provider's monthly cap: on
a daily schedule it counts calendar fetches once per refresh period, not once a day. A test
regenerates the table and fails if this page and the code disagree.

<!-- cadence-table:start -->
| Configuration | Calls a run: planned → with the 1.2 retry factor | Runs a month | Calls a month (budgetFit) of the cap | Fits every cap |
|---|---|---|---|---|
| £0: Travelpayouts only, weekly | Travelpayouts calendar 28 → 34 | 4.33 | Travelpayouts 148 of 50,000 | yes |
| $40: both providers, weekly (the example) | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101; SearchApi itinerary search 50 → 60 | 4.33 | Travelpayouts 148 of 50,000; SearchApi 698 of 10,000 | yes |
| $40: both providers, daily (`0 5 * * *`) | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101; SearchApi itinerary search 50 → 60 | 30.42 | Travelpayouts 170 of 50,000; SearchApi 2,330 of 10,000 | yes |
| $40: both providers, weekly, `maxCells` 200 | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101; SearchApi itinerary search 1,000 → 1,200 | 4.33 | Travelpayouts 148 of 50,000; SearchApi 5,638 of 10,000 | yes |
| SearchApi `trial`: both providers, weekly | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101 (refused: over the provider-lifetime cap); SearchApi itinerary search 50 → 60 (refused: over the provider-lifetime cap) | 4.33 | Travelpayouts 148 of 50,000; SearchApi 0 (scheduled runs leave it out) | yes |
<!-- cadence-table:end -->

On `trial` the 100 lifetime credits cannot hold one full SearchApi run of the example, so a
manual run is refused for SearchApi and scheduled runs leave SearchApi out; `trial` is for the
smoke test.

When you save a definition, the form shows its budget fit: runs a month × the estimate,
compared with every cap. A warning there means the schedule will meet a cap before the month
ends; enabling a schedule whose provider month does not fit is refused.

## Pausing

- **Stop a schedule:** untick "enabled" on the definition (or `PUT /api/definitions/:id` with
  `"enabled": false`). The job is removed at once; turning it back on re-registers it.
- **Cancel a run in progress:** the Cancel button on the status bar. Cells not yet fetched go
  back to "not searched"; Resume continues from there later.
- **Paused by the app:** a run stops itself as `paused_budget` (a cap was reached) or
  `paused_error` (every provider failed, or the rate limiter's queue deadline passed). The
  status bar shows the reason. A pause on a provider or global cap resumes by itself when the
  cap window reopens; a pause on the run's own cap resumes only when you press Resume; an
  error pause with a known retry time resumes at that time; otherwise use Resume after fixing
  the cause.
- While any run is active or paused, the next scheduled firing does not start a second run;
  the status bar shows "schedule blocked since <date>". A paused run older than
  `discoveryRefreshHours` is cancelled at the next firing and a fresh run starts.

## Missed firings

The scheduler does not catch up. If the host was off or asleep at 05:00 on Monday, that run
is skipped. On the next boot the app records an execution with status `skipped_missed` and
sends an operator notification, so the gap is visible in the run history; the next firing
runs normally. To run now, use "Run now" on the definition.

A run that a container restart interrupts is marked `interrupted` and resumes on boot (up to
`MAX_AUTO_RESUMES` times without progress, default 3). `docker compose stop` gives the app
30 seconds to stop its run and release the database cleanly.
````

If the engine on main has changed since 2026-10-17 and the table differs, regenerate it from `renderCadenceTable()` (print it from a scratch test), paste it between the markers, and report the changed numbers to Fable.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/scheduling.test.ts`
Expected: PASS (2 tests, about 2 s).

- [ ] **Step 6: Commit**

```bash
git add docs/scheduling.md docs/examples apps/api/test/deploy && git commit -m "wp12: scheduling doc with the cadence table generated from the engine's estimate and budgetFit"
```

### Task 12.7: `docs/setup.md`, held to the code and to the operations rules

**Files:**
- Create: `docs/setup.md`
- Test: `apps/api/test/deploy/docs.test.ts`

**Interfaces:**
- Consumes: `EXIT` (WP4b), `definitionCreateRequestSchema`, `findBannedWords`, `BANNED_WORD_ALLOWLIST` (WP0), `loadAirportsDataset`, `AIRPORTS_DATA_DIR` (WP3).

Rules (spec §1, §11, §13; decisions 61, 63; round-1 review): the JSON block in `setup.md` is the example file byte for byte; the exit-code table lists exactly `EXIT`'s values (the smoke test's 2 and 3 arrive with WP13); recordings are local-only (the `.gitignore` lines, the wording, the two git checks); the doc names the commands that destroy the volume and its backups and how backups leave it; auth turns off only through the Tailscale-only override; the health check is called liveness only and the doc says where `degraded` shows; the restore runs `check-backup.mjs` and keeps the current database aside, and quotes the api-limits heading on month-to-date spend; the Mailpit settings are shell exports, never a dotenv block; the placeholder password is shorter than the config accepts and `.env` is made private; no smoke-test text until WP13; no banned word; no airport or metro code but the worked example's, with a committed list of capitalised words that collide with codes (`NOT_PLACES`), extended only with a word, never a place.

`docs/setup.md` sections: 1 auth (random password, `chmod 600 .env`, the docker group), 2 the £0 configuration (secrets only in `.env`, the fixed variables, publishing the repository), 3 other devices (`ALLOWED_HOSTS`, the loopback mapping and firewalls, Tailscale, a reverse proxy, `TRUST_PROXY` on a single-user host, the Tailscale-only override), 4 alert email, 5 the example, 6 the data directory and backups (what destroys the volume, the daily backup copied off it with private permissions, failure signals, the restore), 7 growth, 8 fixture recording, 9 one app and one user (the lock after a graceful and a hard stop), 10 exit codes, 11 operating it (start at boot, health, logs, upgrade, rollback, base image updates), 12 local development.

- [ ] **Step 1: Write the failing test**

`apps/api/test/deploy/docs.test.ts`:

```ts
// Spec §1, §11, §13 and plan decisions 26, 36, 61: the operator docs carry the importable London → New York example
// and no other route, the plan's single exit-code table as the code defines it, and no banned word.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiContract, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/tools/types.js';
import { between, REPO, read } from './files.js';

/** Operator-facing docs, held to the spec §11 word list and to the worked example. */
const OPERATOR_DOCS = ['api-limits.md', 'scheduling.md', 'setup.md'];
/** Research notes that quote vendor terminology verbatim; not operator-facing text. */
const RESEARCH_NOTES = ['providers.md'];
/** The worked example's airports and their metro codes: the only places the docs may name (spec §1). */
const WORKED_EXAMPLE = ['LHR', 'LGW', 'JFK', 'EWR', 'LON', 'NYC'];
/** Capitalised words in the docs that happen to be IATA codes too; extend only with a word, never a place. */
const NOT_PLACES = ['API', 'DIR', 'GBP', 'GET', 'PWD', 'TLS', 'VPS', 'WAL'];

const example: unknown = JSON.parse(read('docs/examples/london-new-york.json'));

describe('the example definition (spec §1, §11)', () => {
  it('parses with definitionCreateRequestSchema', () => {
    const r = apiContract.definitionCreateRequestSchema.safeParse(example);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });

  it('is the worked example with the spec §11 form defaults and the 40usd preset budget', () => {
    expect(example).toMatchObject({
      origins: ['LHR', 'LGW'],
      destinations: ['JFK', 'EWR'],
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] },
      budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
      providers: { discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
      scheduleCron: '0 5 * * 1',
      scheduleTz: 'Europe/London',
    });
  });

  it('the JSON block in setup.md is exactly docs/examples/london-new-york.json, byte for byte', () => {
    const block = between(
      read('docs/setup.md'),
      '<!-- example-definition:start -->\n```json\n',
      '```\n<!-- example-definition:end -->',
    );
    expect(block).toBe(read('docs/examples/london-new-york.json'));
  });
});

describe('docs/setup.md exit codes (the plan’s single table, apps/api EXIT)', () => {
  // why: the smoke test's 2 and 3 are documented by WP13 with its route (decision 63)
  it('lists every code of EXIT and nothing else', () => {
    const table = between(read('docs/setup.md'), '## 10. Exit codes', '\n## 11.');
    const codes = [...table.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
    expect(codes).toEqual([...new Set(Object.values(EXIT))].sort((a, b) => a - b));
  });
});

describe('recorded vendor responses are local-only (decision 61)', () => {
  it('git ignores every recording but our params allowlists, and setup.md says recordings are never committed', () => {
    const lines = read('.gitignore').split('\n');
    expect(lines).toContain('packages/providers/fixtures/recorded/**/*.json');
    expect(lines).toContain('!packages/providers/fixtures/recorded/**/params-*.json');
    const setup = read('docs/setup.md').replace(/\s+/g, ' ');
    expect(setup).toContain('Recorded vendor responses are local-only and never committed');
    expect(setup).toContain('**Publishing the repository.**');
    // why: review sec-001 — the doc gives checks that see tracked files and history, not only the working tree
    expect(setup).toContain('git ls-files packages/providers/fixtures/recorded');
    expect(setup).toContain('git log --all --format= --name-only -- packages/providers/fixtures/recorded');
    for (const file of OPERATOR_DOCS)
      expect(read(`docs/${file}`)).not.toMatch(/private-repo|committed recorded|recorded tree is committed/i);
  });
});

describe('docs/setup.md operations rules (plan decision 63; round-1 review)', () => {
  const setup = read('docs/setup.md');
  const flat = setup.replace(/\s+/g, ' ');

  it('names the commands that destroy the volume and its backups, and the copy off the volume', () => {
    for (const command of [
      'docker compose down -v',
      'docker volume rm get-me-there_gmt-data',
      'docker system prune --volumes',
    ])
      expect(flat).toContain(command);
    expect(flat).toContain('docker compose cp app:/data/backups/. /var/backups/get-me-there/');
    expect(flat).toContain('install -d -m 0700');
  });

  it('turns auth off only through the Tailscale-only override file', () => {
    expect(setup).toContain('ALLOW_UNAUTHENTICATED: "true"');
    expect(setup).toContain('COMPOSE_FILE=docker-compose.yml:tailscale-only.yml');
  });

  it('calls the health check liveness only and says where a degraded app shows', () => {
    expect(flat).toContain('liveness check only, and Docker does not restart an unhealthy container');
    expect(flat).toContain('the status bar shows it and the log records it');
  });

  it('restores through check-backup, keeping the current database aside', () => {
    expect(setup).toContain('scripts/check-backup.mjs /data/restore.db');
    expect(setup).toContain('.pre-restore');
    const heading = 'Restoring a backup resets month-to-date spend';
    expect(read('docs/api-limits.md')).toContain(`## ${heading}`);
    expect(setup).toContain(`("${heading}")`);
  });

  it('puts the Mailpit settings in the shell, never in a dotenv block', () => {
    const dotenvBlocks = [...setup.matchAll(/```dotenv\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
    expect(dotenvBlocks.some((b) => b.includes('SMTP_TLS=none'))).toBe(false);
    expect(setup).toContain('export SMTP_HOST=127.0.0.1');
  });

  it('uses a placeholder password the config refuses, and a private .env', () => {
    expect(setup).toContain('APP_BASIC_AUTH_PASS=CHANGE-ME');
    expect('CHANGE-ME'.length).toBeLessThan(12);
    expect(setup).toContain('chmod 600 .env');
  });

  it('leaves the smoke test to WP13 (decision 63)', () => {
    expect(setup).not.toMatch(/smoke:live|\/api\/tools\/smoke/);
  });
});

describe('operator docs (spec §11 banned words; spec §1 worked example only)', () => {
  it('covers every docs/*.md: the operator docs and the research notes', () => {
    const all = readdirSync(join(REPO, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .sort();
    expect(all).toEqual([...OPERATOR_DOCS, ...RESEARCH_NOTES].sort());
  });

  it.each(OPERATOR_DOCS)('%s contains no banned word', (file) => {
    const text = read(`docs/${file}`);
    const hits = findBannedWords(text, BANNED_WORD_ALLOWLIST).map(
      (h) => `${h.word} @${h.index}: …${text.slice(Math.max(0, h.index - 30), h.index + 30)}…`,
    );
    expect(hits).toEqual([]);
  });

  it.each([...OPERATOR_DOCS.map((f) => `docs/${f}`), 'docs/examples/london-new-york.json'])(
    '%s names no airport or metro code but the worked example’s',
    (path) => {
      const dataset = loadAirportsDataset(AIRPORTS_DATA_DIR);
      const places = new Set([...dataset.airports.map((a) => a.iata), ...Object.keys(dataset.metros)]);
      const named = [...read(path).matchAll(/\b[A-Z]{3}\b/g)].map((m) => m[0]);
      const others = named.filter(
        (w) => places.has(w) && !WORKED_EXAMPLE.includes(w) && !NOT_PLACES.includes(w),
      );
      expect([...new Set(others)]).toEqual([]);
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/docs.test.ts`
Expected: FAIL: every test that reads `docs/setup.md` with `ENOENT … docs/setup.md` (the `describe` of operations rules fails while collecting), and the docs-set test (`setup.md` missing from the listing); the example tests and the two existing docs' scans PASS.

- [ ] **Step 3: Implement**

`docs/setup.md`:

````markdown
# Setup

This gets one container running on a machine you control, reachable only by you, with a
daily backup. Everything below uses the worked example London → New York; put your own
airports in the Definitions form, never in a file of this repository.

## 1. Authentication first

The container listens on all interfaces inside Docker, compose publishes it on
`127.0.0.1:3000` only, and the app refuses to start without basic auth. Create `.env` next to
`docker-compose.yml`, readable by you alone, with a password nobody else has seen:

```bash
openssl rand -base64 24       # prints a random password; use it below
touch .env && chmod 600 .env
```

```dotenv
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=CHANGE-ME
```

Replace `CHANGE-ME` with that random value (the app needs at least 12 characters, so the
placeholder itself is refused). If a value contains `$`, wrap it in single quotes, because
compose interpolates `$` in `.env`.

Basic auth sends the password with every request. Over plain HTTP that is only acceptable on
loopback. To reach the app from another device, put TLS in front of it (section 3).

Anyone who can run `docker` on this host can read the container's environment, keys included
(`docker inspect`), so treat membership of the `docker` group as root and keep this host to
yourself.

## 2. The £0 configuration: three lines

Get a free Travelpayouts token (Travelpayouts account → API token) and add it:

```dotenv
TRAVELPAYOUTS_TOKEN=your-travelpayouts-token
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=CHANGE-ME
```

That is the whole `.env` for £0. Then:

```bash
docker compose up -d --build --wait   # the first boot can take up to 4 minutes
docker compose ps                     # "healthy"
```

Open <http://127.0.0.1:3000> and sign in. Then set up the daily backup of section 6 before
you rely on the app.

What £0 gives: calendar prices from the Aviasales cache only, every row labelled "constraints
not checked", and coverage that depends on what Aviasales users searched recently. Before you
save a definition, press **Coverage check** on the form: it shows cached rows per airport pair
and month, at no cost.

To add SearchApi later (the $40 plan, scraping-derived; see `docs/api-limits.md`):

```dotenv
SEARCHAPI_KEY=your-searchapi-key
SEARCHAPI_PLAN=40usd
SEARCHAPI_BILLING_DAY=1      # the day of the month your subscription renews (1–28)
```

then `docker compose up -d`. Without `SEARCHAPI_PLAN=40usd` the key runs on the one-off
`trial` allowance and scheduled runs leave SearchApi out.

**Secrets are kept only in `.env`.** The repository's `.gitignore` keeps `.env` and every
`.env.*` file except `.env.example` out of git, `.dockerignore` keeps them out of the image,
and compose passes the container only the variables it lists (never the whole file), so a key
reaches the app and nothing else. Never put a key in `docker-compose.yml`, in a command line or
in a definition. The database holds no key or password; back up `.env` separately and keep it
private.

Never put `NODE_ENV`, `IN_CONTAINER` or `ALLOW_FIXTURE_PROVIDER` in `.env` for the container:
compose does not pass them (the image sets the first two), and fixture data cannot be enabled
in a container. `DATABASE_PATH`, `PORT` and `BIND_ADDRESS` are fixed in `docker-compose.yml`;
setting them in `.env` changes nothing (section 3 says how to use another host port).

**Publishing the repository.** The repository holds no key and no vendor response: `.env` and
every recording under `packages/providers/fixtures/recorded/` are ignored by git (only our own
`params-*.json` allowlists are tracked), and the commits that once held recordings were purged
from history. Before you make it public, check both, from the repository root:

```bash
git ls-files packages/providers/fixtures/recorded
git log --all --format= --name-only -- packages/providers/fixtures/recorded | sort -u
```

Each must list only `params-*.json` and `.gitkeep` files. Never force-add a recording.

## 3. Reaching it from other devices: ALLOWED_HOSTS and TLS

The app rejects any request whose `Host` header is not in `ALLOWED_HOSTS`, and the error names
the header value and the variable. The default is `localhost:3000,127.0.0.1:3000`. Setting the
variable replaces the default, so list every hostname you will type in a browser, including
the local ones if you still use them.

Keep the port mapping on `127.0.0.1` and put `tailscale serve` or a reverse proxy in front.
Changing it to `3000:3000` or `0.0.0.0:3000:3000` publishes the app to every network the host
is on, past a host firewall such as ufw (Docker writes its own packet-filter rules). If the
port is reachable, basic auth is the only barrier between a stranger and your API budget. To
use another host port, change only the left side: `127.0.0.1:8080:3000`.

**Tailscale** (the app stays off the public internet):

```bash
tailscale serve --bg 3000
```

```dotenv
ALLOWED_HOSTS=gmt-host.tail0000.ts.net,localhost:3000,127.0.0.1:3000
TRUST_PROXY=true
```

`tailscale serve` terminates TLS with a certificate for your tailnet name and forwards to
`127.0.0.1:3000`. Use your machine's own `*.ts.net` name.

**Reverse proxy** on a VPS, here Caddy, which obtains a certificate automatically:

```caddyfile
flights.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```dotenv
ALLOWED_HOSTS=flights.example.com
TRUST_PROXY=true
```

`TRUST_PROXY=true` makes the failed-login rate limit read the client address from
`X-Forwarded-For`; set it only when a proxy you control sits in front and is the only way in.
On a host shared with other users it lets any of them, through the loopback port, claim any
client address and dodge that limit; use it on a single-user host.

**Without basic auth, Tailscale only.** The default compose always keeps auth on: it does not
pass `ALLOW_UNAUTHENTICATED` to the container. On a host that nothing but your tailnet can
reach, you may turn auth off with an override file next to `docker-compose.yml`, named
`tailscale-only.yml`:

```yaml
# tailscale-only.yml: only on a host reachable from nothing but your tailnet.
services:
  app:
    environment:
      ALLOW_UNAUTHENTICATED: "true"
```

and in `.env`, with the two auth lines removed:

```dotenv
COMPOSE_FILE=docker-compose.yml:tailscale-only.yml
```

Compose then reads both files for every command. Remove the line (and put the auth lines back)
the moment the host is reachable any other way.

## 4. Alert email

Without email settings, alerts and operator messages go to the log only, and the Alerts view
records each such alert as suppressed ("email not configured"). To send email, set all of
these (all or nothing; boot names any that is missing):

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_TLS=implicit            # implicit (port 465) or starttls (port 587, TLS required)
SMTP_USER=operator@example.com
SMTP_PASS=your-smtp-password
ALERT_EMAIL_TO=operator@example.com
ALERT_EMAIL_FROM=get-me-there@example.com
```

`ALERT_EMAIL_TO` and `ALERT_EMAIL_FROM` take one address each. `SMTP_TLS=none` is refused in
the container; it exists for the local mail catcher of section 12. `ALERT_EMAIL_MAX_PER_HOUR`
(default 20) caps outgoing email: beyond it a message is logged and dropped, and the alerts it
carried stay queued with the reason shown in the Alerts view.

Set `APP_BASE_URL` to the `https://` address you type (for example
`APP_BASE_URL=https://flights.example.com` or your `https://…ts.net` name) so alert emails
link straight to the results row; left empty, emails carry relative links.

## 5. Import the example definition

On the Definitions page choose **Import example**, or paste this JSON into the import box:

<!-- example-definition:start -->
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
<!-- example-definition:end -->

It searches 2 origins × 2 destinations, departures from 7 days ahead over 182 days, stays of
10 to 21 nights (8,736 date pairs), every Monday at 05:00 London time. Itinerary search runs
on the 10 cheapest calendar cells with 2 outbound options each. `docs/scheduling.md` shows what
that costs in calls a run and a month.

On the £0 configuration, replace the `providers` block before importing:

```json
"providers": { "discovery": ["travelpayouts"], "verification": [], "discoveryRefreshHours": { "travelpayouts": 168 } }
```

The form shows the estimate before you create the definition; creating it is your
confirmation of that cost.

## 6. The data directory and backups

The database is one file on the named volume `get-me-there_gmt-data`, `/data/get-me-there.db`
inside the container, and its backups go to `/data/backups` (the `backups` folder beside
`DATABASE_PATH`). The image runs as the unprivileged user `node` (uid 1000), which owns
`/data`; backups are readable by that user only.

**The volume is the only copy until you copy backups off it.** `/data/backups` lives in the
same volume as the database, so it dies with it. `docker compose stop`, `restart` and `down`
keep the volume. These destroy it, with the database, the spend ledger and every in-volume
backup: `docker compose down -v`, `docker volume rm get-me-there_gmt-data`, and
`docker system prune --volumes` or `docker volume prune`. Never run them on this host unless
you mean to start from nothing.

The app backs the database up by itself before applying a schema migration (on an upgrade)
and refuses to start if that backup fails. A backup on demand runs the same routine:

```bash
docker compose exec -T app node scripts/backup.mjs
```

It writes `/data/backups/get-me-there-<UTC timestamp>.db` with SQLite `VACUUM INTO` (safe
while the app runs), checks it with `PRAGMA integrity_check`, refuses to overwrite an existing
file, keeps the newest 5, prints one line `{"ok":true,"file":"…"}`, and exits 74 on any
failure (section 10).

**Daily backup, copied off the volume.** Create a private folder for the host copies once:

```bash
sudo install -d -m 0700 -o operator /var/backups/get-me-there
```

Then add a cron job, for example `/etc/cron.d/get-me-there` (adjust the user, the path of
your checkout and the address):

```cron
MAILTO=operator@example.com
15 3 * * * operator cd /opt/get-me-there && umask 077 && out="$(docker compose exec -T app node scripts/backup.mjs)" && logger -t get-me-there-backup "$out" && docker compose cp app:/data/backups/. /var/backups/get-me-there/ && find /var/backups/get-me-there -name 'get-me-there-*.db' -mtime +30 -delete
```

`umask 077` keeps the host copies readable by you alone (they hold your whole price and alert
history and your alert addresses). Each step runs only if the one before succeeded. The backup line goes to the system log
(`journalctl -t get-me-there-backup`); a failing step makes cron mail its error to `MAILTO`, if the host can
send mail. If it cannot, append `&& curl -fsS https://hc-ping.com/<your-check-id>` (or any
dead-man's-switch service) so you hear about a backup that did not happen. The thing to watch
is the age of the newest file in `/var/backups/get-me-there`: older than a day means the job
is failing. That keeps 5 copies in the volume and 30 days on the host.

**Off-box copy**: a backup on the same disk does not survive the disk. Send the host copies to
storage only you can read, for example:

```bash
rsync -a /var/backups/get-me-there/ backup-host:get-me-there/
```

### Restore

1. Pick the backup and stop the app: `docker compose stop app`.
2. Copy the backup into the volume as the app's user, so it has the right owner whoever owns
   the host copy, and check it before anything is replaced:

   ```bash
   docker compose run --rm --no-deps -T --entrypoint sh app -c 'cat > /data/restore.db' \
     < /var/backups/get-me-there/get-me-there-2026-10-14T03-15-00-000Z.db
   docker compose run --rm --no-deps -T --entrypoint node app scripts/check-backup.mjs /data/restore.db
   ```

   The check prints `{"ok":true,…}`; on exit 74 the backup is damaged: delete
   `/data/restore.db` the same way and pick another.
3. Put the current database aside (never delete it) and swap the backup in:

   ```bash
   docker compose run --rm --no-deps -T --entrypoint sh app -c 'cd /data &&
     for f in get-me-there.db get-me-there.db-wal get-me-there.db-shm; do
       if [ -e "$f" ]; then mv "$f" "$f.pre-restore"; fi
     done && mv restore.db get-me-there.db'
   ```

4. Start and check: `docker compose up -d --wait`, then `curl -fsS http://127.0.0.1:3000/api/health`.
   Delete the `*.pre-restore` files once you are satisfied.
5. Restoring resets month-to-date spend: ledger rows written after the backup are gone. Lower
   the caps and reconcile with the vendor dashboard before the next run, as described in
   `docs/api-limits.md` ("Restoring a backup resets month-to-date spend").

**Docker Desktop (macOS, Windows):** keep the database on the named volume. Bind-mounting a
host folder over `/data` goes through Docker Desktop's file-sharing layer, where SQLite's WAL
locking is not reliable and the database can be corrupted. On a Linux host a bind mount works
if the directory is owned by uid 1000; the app stops at boot with exit 73 and a message naming
the directory if it cannot write there.

## 7. Expected database growth

These are estimates from the row counts of one run of the worked example (8,736 cells); the
daily maintenance job logs the measured database size (`dbBytes`), which is the number to
trust.

| Configuration, weekly schedule | Rows per run | Approximate growth |
|---|---|---|
| £0 (Travelpayouts only) | ~8,700 cell rows + ~8,700 outcome rows + a few hundred prices | ~4 MB a run, ~20 MB a month |
| $40 (both providers) | ~8,700 cell rows + ~26,000 outcome rows + up to ~8,700 calendar prices + ~100 itinerary observations | ~11 MB a run, ~50 MB a month |

Growth scales with cells (origins × destinations × window days × nights) and with runs per
month. Expired cache rows and old cache-hit ledger rows are pruned daily; run history is
kept, so a year of the $40 example is roughly 600 MB. Deleting a definition or an alert rule
only marks it deleted: its runs, prices and alert events stay in the database and in History.

## 8. Fixture recording

Fixture recording is a development task, not an operations one, and never runs in the
container (the app refuses it there). Recorded vendor responses are local-only and never
committed: SearchApi's results come from Google Flights and Travelpayouts' from the Aviasales
cache, and neither may be republished. Git ignores everything under
`packages/providers/fixtures/recorded/` except our own `params-*.json` parameter allowlists, the
image never contains a recording, and a recording exists only on the disk of the machine that
made it (keep your own private copy outside the repository if you want one). Record on a
development checkout with the app stopped, worked example only (any other route needs
`--out DIR` outside the repository), and look at the plan first with `--dry-run`:

```bash
pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run
pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03
```

Recording spends SearchApi credits up to `--budget` (choose a month inside the next year).

## 9. One app per database, one user for every process

- **One app.** The app holds a lock in the database and renews it every 30 seconds. A second
  app started on the same database (a second compose project on the same volume, or
  `docker compose run app` while `app` is up) waits up to 90 seconds and then exits 75; it never
  takes the lock from a running app.
- **After a stop.** A graceful stop (`docker compose stop`, `restart`, `down`) releases the
  lock, so the next start does not wait. After a hard stop (a crash, `docker kill`, power loss)
  the lock is left behind: the next start logs `waiting for app_lock` with the lock's age for
  up to 90 seconds, until three renewals have been missed, then logs `taking over a stale
  app_lock` and boots. The health check's start period allows for that wait.
- **One user.** Run every command against the database as the app's user, which
  `docker compose exec app …` and `docker compose run app …` do by default (`node`). Never add
  `--user root` or `-u 0`: a check that only reads the database can still leave SQLite's `-wal`
  and `-shm` side files behind, and side files owned by root stop the app from opening its own
  database. On a development checkout, run `pnpm record:fixtures` and `pnpm dev` as the same OS
  user.
- A tool started from the command line while the app runs exits 75 and names the route to use
  instead.

## 10. Exit codes

Every command-line entry point (the app itself, `pnpm record:fixtures`,
`node scripts/backup.mjs`, `node scripts/check-backup.mjs`) and the `exitCode` of the
`/api/tools/*` routes use this one table:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | a tool run failed (recording: a required call did not return its expected status; the backup scripts: the built packages could not be loaded) |
| 64 | bad arguments (usage), or a recording of another route than the worked example without `--out DIR` outside the repository |
| 65 | recording refused for spend: it would exceed `--budget` with earlier recordings (rerun with `--confirm-rerun`), or a provider's budget window has less room than the run needs |
| 70 | refused because `NODE_ENV=test`, or because fixture data is enabled |
| 73 | the data directory or `<data dir>/backups` is not writable, the database lock cannot be read, or the pre-migration backup cannot be attempted |
| 74 | a backup failed (boot, `scripts/backup.mjs`) or is unusable (`scripts/check-backup.mjs`); at boot, migrations were not applied |
| 75 | the database lock is held by another running app or tool |
| 78 | bad configuration; the message names every variable to fix |

With `restart: unless-stopped`, an app that exits 73, 74, 75 or 78 restarts and fails the same
way until you fix the cause; `docker compose logs app` shows the message. The health check's
240-second start period covers the lock wait of section 9, the pre-migration backup, the
migrations and the first airport seeding.

## 11. Operating it

- **Start at boot.** `restart: unless-stopped` brings the app back after a reboot only if the
  Docker daemon itself starts at boot: `sudo systemctl enable docker` on Linux.
- **Health.** `docker compose ps` shows `healthy` while `GET /api/health` answers; that is a
  liveness check only, and Docker does not restart an unhealthy container. Signed in,
  `curl -u operator http://127.0.0.1:3000/api/health` adds the detail: the database, each
  provider, and the scheduler's job count, next run, last run and `degraded` flag. A
  `degraded` app (scheduled jobs missing, a run stuck past `STUCK_AFTER_HOURS`) keeps serving;
  the status bar shows it and the log records it. Look at the detail when the newest run in
  History is older than your schedule says it should be.
- **Logs.** The app writes one JSON object a line; compose keeps 5 files of 10 MB. To follow
  one run: `docker compose logs --no-log-prefix app | jq -R 'fromjson? | select(.executionId == "<id>")'`.
- **Upgrade.** Back up first (section 6), then from your checkout: `git pull`,
  `docker compose up -d --build --wait`. When the new version brings schema migrations, the app
  backs the database up again before applying them and logs `backup before N migration(s):
  <file>`.
- **Roll back a failed upgrade.** Check out the previous version, restore the backup the log
  named (section 6, Restore), and run `docker compose up -d --build --wait`. An older version
  cannot use a database a newer one has migrated, so the restore is required.
- **Base image updates.** The `Dockerfile` pins `node:22-slim` by digest, so security fixes to
  Node and Debian arrive only when the pin moves. Once a month, run
  `docker buildx imagetools inspect node:22-slim`, put the new top-level digest in every `FROM`
  line, and upgrade as above.

## 12. Local development

```bash
pnpm install
mkdir -p data
NODE_ENV=development DATABASE_PATH="$PWD/data/dev.db" BIND_ADDRESS=127.0.0.1 pnpm dev
pnpm test
docker compose --profile dev up -d mailpit   # optional: catch alert email locally
```

`pnpm dev` runs the api and the web app with hot reload against `data/dev.db` (`data/` is in
`.gitignore`); it reads no `.env`, so it takes its settings from the shell. To send its mail to
Mailpit, export these in that shell, never in `.env` (the container refuses `SMTP_TLS=none`
and would exit 78):

```bash
export SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_TLS=none SMTP_USER=dev SMTP_PASS=dev
export ALERT_EMAIL_TO=operator@example.com ALERT_EMAIL_FROM=get-me-there@example.com
```

Messages appear at <http://127.0.0.1:8025>. `SMTP_TLS=none` is accepted only for a loopback
host; the container never uses Mailpit.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy`
Expected: PASS: 72 tests in 7 files (dockerfile 31, envExample 3, compose 11, backupCli 2, apiLimits 3, scheduling 2, docs 20). A banned-word failure lists `word @index: …context…`: reword the sentence (the allowlist is core's; never add a local one). A place failure names the code: remove it, or, if it is an ordinary word (as `GET` and `PWD` are), add it to `NOT_PLACES` with the doc's sentence in the commit message.

- [ ] **Step 5: Commit**

```bash
git add docs/setup.md apps/api/test/deploy/docs.test.ts && git commit -m "wp12: setup doc with backups, restore, operations and auth rules held by tests"
```

### Task 12.8: The web app's example constant equals the docs JSON

WP9 is merged (Task 12.0), so `apps/web/src/example.ts` parses the docs JSON through the create schema at load. This test proves the import and the file agree.

**Files:**
- Test: `apps/web/test/example.test.ts`

**Interfaces:**
- Consumes: `EXAMPLE_DEFINITION` (WP9), `docs/examples/london-new-york.json` (Task 12.6).

- [ ] **Step 1: Write the test**

`apps/web/test/example.test.ts`:

```ts
// Spec §1, §11 "import example" (plan "Web", decision 36): the Definitions form's example is docs/examples/
// london-new-york.json, imported rather than copied, so the docs and the button can never offer different routes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DEFINITION } from '../src/example.js';

// why: plain paths, because this project runs under jsdom, whose URL class node:fs does not accept
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

describe('EXAMPLE_DEFINITION (WP9) and the docs JSON (WP12)', () => {
  it('equals docs/examples/london-new-york.json, the JSON docs/setup.md shows', () => {
    expect(EXAMPLE_DEFINITION).toEqual(JSON.parse(read('docs/examples/london-new-york.json')));
  });

  it('imports the docs JSON rather than copying it', () => {
    expect(read('apps/web/src/example.ts')).toContain("from '../../../docs/examples/london-new-york.json'");
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @gmt/web exec vitest run test/example.test.ts`
Expected: PASS (2 tests). A failure is a WP9 defect: report it to Fable with the diff; do not edit WP9's file from this branch. To see it fail, change `"0 5 * * 1"` to `"0 6 * * 1"` in the JSON inside a scratch checkout only.

- [ ] **Step 3: Commit**

```bash
git add apps/web/test/example.test.ts && git commit -m "wp12: the web app's example constant equals the docs JSON"
```

### Task 12.9: CI: actions pinned by SHA, and the `docker` job through compose

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the image (Task 12.1), compose (Task 12.3), the backup CLIs (Task 12.4), the documented restore (Task 12.7), WP8's `/api/health`, lock wait and shutdown (Task 12.0).

Rules (decision 63; reviews devops-001, devops-008, arch-wp12-r1-003, arch-wp12-r1-011, devops-013, sec-009): every action is pinned by commit SHA with its tag in a comment; WP0's "Dockerfile sets production and container flags" grep step goes (dockerfile.test.ts and the image check cover it); the `docker` job needs `test` (lint, boundaries, casts, typecheck, tests, secret scan) and drives the shipped `docker-compose.yml` with the documented three-line `.env`, so compose's interpolation, hardening, volume and `init` are what is tested. It proves: no curl, no secret, database or recording in the image and no credential in its history; healthy boot; the backup as `node` into a 0700 directory; a second app refused with 75; a graceful stop that exits 0 within 30 s and leaves no lock to wait on; a hard kill after which the restarted app logs `waiting for app_lock` and `taking over a stale app_lock` and becomes healthy within the 300 s wait; and the documented restore. The cleanup step alone runs `down -v`, on CI's throwaway volume.

- [ ] **Step 1: Run the job's commands locally (they fail before Tasks 12.1–12.4)**

Run, on a host with Docker: the `run:` blocks of the `docker` job below in order, by hand, in a scratch checkout (the `.env` step writes CI-only values; never in a checkout that holds your real `.env`).
Expected before the earlier tasks: a failure at the first missing piece. After them: every step exits 0; the second-app step takes about 90 s; the hard-kill step about 90–120 s.

- [ ] **Step 2: Implement**

`.github/workflows/ci.yml` (the whole file):

```yaml
name: ci
on:
  push:
    branches: [main, 'wp/**']
  pull_request: {}
# Actions are pinned by commit SHA (plan decision 63); the comment names the tag the SHA was read from on 2026-10-17.
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4 (v4.4.0)
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4 (v4.3.0)
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4 (v4.4.0)
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm boundaries
      - run: pnpm casts
      - run: pnpm -r typecheck
      - run: pnpm test:coverage
      - run: pnpm secret-scan
      - name: secret scan catches a planted fixture
        run: |
          mkdir -p packages/providers/fixtures/recorded/planted
          echo '{"url":"https://x/?api_key=ABCDEFGH12345678"}' > packages/providers/fixtures/recorded/planted/p.json
          if pnpm secret-scan; then echo "scan missed the plant"; exit 1; fi
          rm -r packages/providers/fixtures/recorded/planted
  docker:
    # Spec §13 through the shipped docker-compose.yml: the image builds from the lockfile, runs as node with the
    # production flags, no curl and no secret or recording inside; compose boots it healthy on a fresh volume; it backs
    # itself up as node; a second app is refused (decision 53); a graceful stop exits 0 and releases the lock; after a
    # hard kill the restarted app takes the stale lock over (decision 63); a backup restores by the documented steps.
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4 (v4.4.0)
      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3 (v3.12.0)
      - name: Compose file is valid
        run: docker compose --env-file /dev/null config --quiet
      - name: Build the image through compose
        run: docker compose --env-file /dev/null build app
      - name: Image runs as node with the production flags and carries no curl or wget
        run: |
          test "$(docker run --rm --entrypoint id get-me-there:local -u)" = "1000"
          docker run --rm --entrypoint node get-me-there:local -e "process.exit(process.env.NODE_ENV === 'production' && process.env.IN_CONTAINER === '1' ? 0 : 1)"
          if docker run --rm --entrypoint sh get-me-there:local -c 'command -v curl || command -v wget'; then exit 1; fi
      - name: Image holds no secret, database or recording, and its history no credential
        run: |
          found="$(docker run --rm --entrypoint sh get-me-there:local -c \
            'find / -xdev -path "*/node_modules" -prune -o \( -name ".env" -o -name ".env.*" -o -name "*.db" -o -name "*.pem" -o -name "*.key" -o -path "*/fixtures/recorded*" \) -print 2>/dev/null; true')"
          if [ -n "$found" ]; then echo "$found"; exit 1; fi
          if docker history --no-trunc get-me-there:local | grep -Ei '(token|_key|pass(word)?|secret)='; then exit 1; fi
      - name: Compose boots it healthy with the documented three-line .env
        run: |
          # why: CI-only values; the token is a dummy and boot makes no vendor call
          printf 'TRAVELPAYOUTS_TOKEN=ci-dummy-token-0123456789\nAPP_BASIC_AUTH_USER=ci\nAPP_BASIC_AUTH_PASS=ci-password-0123\n' > .env
          chmod 600 .env
          docker compose up -d --wait --wait-timeout 300 || { docker compose logs app; exit 1; }
          curl -fsS http://127.0.0.1:3000/api/health
          test "$(docker compose exec -T app id -un)" = node
          test -z "$(docker compose ps --services --status running | grep -v '^app$')"
      - name: Backup runs inside the container as node, into a private /data/backups
        run: |
          docker compose exec -T app node scripts/backup.mjs | tee backup.json
          test "$(docker compose exec -T app stat -c '%u %a' /data/backups)" = "1000 700"
      - name: A second app on the same volume refuses with 75 (decision 53)
        run: |
          set +e
          docker compose run --rm --no-deps -T app
          code=$?
          set -e
          test "$code" = 75
      - name: A graceful stop exits 0 within the grace period and releases the lock (decision 63)
        run: |
          start=$(date +%s)
          docker compose stop app
          test $(( $(date +%s) - start )) -lt 30
          test "$(docker inspect --format '{{.State.ExitCode}}' "$(docker compose ps -aq app)")" = 0
          since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          docker compose up -d --wait --wait-timeout 120
          if docker compose logs --since "$since" app | grep -F 'waiting for app_lock'; then exit 1; fi
      - name: After a hard kill the restarted app takes the stale lock over (decision 63)
        run: |
          docker compose kill -s KILL app
          since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          docker compose up -d --wait --wait-timeout 300 || { docker compose logs app; exit 1; }
          docker compose logs --since "$since" app | grep -F 'waiting for app_lock'
          docker compose logs --since "$since" app | grep -F 'taking over a stale app_lock'
      - name: A backup restores by the documented steps (docs/setup.md section 6)
        run: |
          file="$(node -p "JSON.parse(require('fs').readFileSync('backup.json','utf8')).file")"
          mkdir -m 0700 ci-backups
          docker compose cp "app:$file" ci-backups/
          docker compose stop app
          docker compose run --rm --no-deps -T --entrypoint sh app -c 'cat > /data/restore.db' < "ci-backups/$(basename "$file")"
          docker compose run --rm --no-deps -T --entrypoint node app scripts/check-backup.mjs /data/restore.db
          docker compose run --rm --no-deps -T --entrypoint sh app -c 'cd /data &&
            for f in get-me-there.db get-me-there.db-wal get-me-there.db-shm; do
              if [ -e "$f" ]; then mv "$f" "$f.pre-restore"; fi
            done && mv restore.db get-me-there.db'
          docker compose up -d --wait --wait-timeout 300
          curl -fsS http://127.0.0.1:3000/api/health
          docker compose exec -T app sh -c 'test -e /data/get-me-there.db.pre-restore'
      - name: Remove the CI container and its throwaway volume
        if: always()
        run: |
          docker compose logs app | tail -n 50 || true
          # why: CI's volume only; docs/setup.md forbids `down -v` on a real host
          docker compose down -v || true
          rm -f .env backup.json
```

- [ ] **Step 3: Run to verify it passes**

Push the branch. Expected: the `test` and `docker` jobs are green.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "wp12: CI pins actions by SHA and drives compose through boot, backup, refusal, stop, kill and restore"
```

## 9. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP12. The WP12-specific risks are pinned by: `compose.test.ts` "never passes NODE_ENV, IN_CONTAINER, ALLOW_FIXTURE_PROVIDER or FIXTURE_COST_MICRO_GBP, and has no env_file" (§5.5), "keeps basic auth on: ALLOW_UNAUTHENTICATED is not forwarded" and "runs with a read-only root, a /tmp tmpfs, no capabilities and no privilege escalation" (decision 63, sec-003); `dockerfile.test.ts` "runs as the non-root user node from the last RUN onwards", "installs no package from the distribution" and "takes no build argument or build secret" (decisions 26, 12; sec-008); `assert-sqlite-prebuilt.test.mjs` "pnpm-lock.yaml pins better-sqlite3 13.0.3 to the integrity recorded in the WP12 brief" (§4); `backupCli.test.ts` (the CLIs follow the bootstraps' rules); `scheduling.test.ts` "matches the table the engine computes" (§8.2); `docs.test.ts` "names no airport or metro code but the worked example's" (§1), "git ignores every recording but our params allowlists" (decision 61) and the operations-rules `describe` (decision 63); the CI steps "A second app on the same volume refuses with 75", "A graceful stop exits 0 … and releases the lock", "After a hard kill the restarted app takes the stale lock over" and "A backup restores by the documented steps" (decisions 53, 63).

## 10. Definition of done

| Command | Expected |
|---|---|
| Task 12.0's checks | every one as shown |
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | `Checked N files … No fixes applied`, exit 0 |
| `pnpm -r typecheck` | exit 0 (the deploy tests through `apps/api/tsconfig.test.json`, the web test through `apps/web/tsconfig.test.json`) |
| `pnpm boundaries` | exit 0 |
| `pnpm casts` | exit 0, `0 casts` |
| `pnpm secret-scan` | `secret scan: clean` |
| `pnpm --filter @gmt/api exec vitest run test/deploy` | 72 tests PASS in 7 files |
| `pnpm vitest run --project scripts` | every script test PASS, including `backup.test.mjs` (14) and `assert-sqlite-prebuilt.test.mjs` (2) |
| `pnpm --filter @gmt/web exec vitest run test/example.test.ts` | 2 tests PASS |
| `pnpm --filter @gmt/api test` | PASS with lines ≥ 85%, branches ≥ 70% (the deploy tests add no `src` file); the recorded-tree tests skip visibly where recordings are absent once WP13's guard is in (decision 61) |
| `pnpm test` | every project PASS |
| `docker compose --env-file /dev/null config --quiet` | exit 0, no output |
| `docker compose build app` | succeeds; `better-sqlite3 13.0.3 prebuilt ok` three times; `workspace packages resolve to dist` |
| `docker compose up -d --wait` (with the three-line `.env`) | `app` healthy within 240 s |
| `docker compose exec -T app node scripts/backup.mjs` | exit 0, one line `{"ok":true,"file":"/data/backups/…"}` |
| `docker compose exec app id -un` | `node` |
| `docker compose stop app` | stops within 30 s with exit code 0 |
| CI on the branch | `test` and `docker` jobs green |

## 11. Open questions

None. Plan decision 63 rules on the round-1 findings marked for judgment (the history wording, the healthcheck, `ALLOW_UNAUTHENTICATED`, the smoke documentation, action pins).

## 12. Changes outside WP12's own files

- Root `package.json`: `packageManager` gains its `+sha512` hash (Task 12.1).
- `apps/api/package.json` and `pnpm-lock.yaml`: dev dependency `yaml` 2.9.1 (Task 12.3).
- New test files in other packages' trees, which change no existing file: `apps/api/test/deploy/*` and `apps/web/test/example.test.ts`.
- `.github/workflows/ci.yml` (WP0's): the `test` job's actions pinned by SHA, its Dockerfile grep step removed, the `docker` job added (Task 12.9).
- `.env.example` (WP0's): regenerated from spec §12.

## 13. For the plan (not yet recorded there)

1. **Assembly (round 2).** On 2026-10-17 every file of this brief was re-assembled on a detached scratch worktree of main at `be59ca1` (spec revision 26 on main) and the brief's code blocks were generated from those files. Stand-ins, in the scratch tree only: a placeholder `apps/api/src/bootstrap/start.ts` (WP8); WP9's `apps/web/src/example.ts` with its `resolveJsonModule` tsconfig edits; WP11's `ALERT_EMAIL_MAX_PER_HOUR` entry in `ALL_VARS`. Results: `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm casts` (422 files, 0 casts) clean; deploy tests 72 in 7 files; scripts project 21 (14 backup CLIs, 2 prebuilt, 5 WP7 cast tests); web example 2; `docker compose --env-file /dev/null config` valid with and without the override file; `pnpm install --frozen-lockfile --offline` accepted the hashed `packageManager`. Not run: `docker build` and the CI job (the Docker daemon was not running); the image digests are from 2026-10-14 and Task 12.1 Step 4 re-inspects them.
2. **The recorded-tree tests fail on a fresh checkout until WP13's guard.** In the scratch worktree `pnpm --filter @gmt/api test` failed one test, `test/recorded/manifest.test.ts` ("is one live recording session of the worked example…"), because decision 61 leaves the recordings off every fresh checkout (only the `params-*.json` allowlists and `.gitkeep` are there). The CI `test` job has the same fresh checkout, so it fails on main as well as on WP12's branch until WP13 adds the visible skip decision 61 asks for. WP12 cannot make its `docker` job green while `test` is red; WP13's guard (or an earlier fix of it) should land first.
3. **`pnpm/action-setup` and the hashed `packageManager`.** The `test` job reads the pnpm version from `packageManager`, which now carries `+sha512.…`. The pinned `pnpm/action-setup` v4.3.0 was not run against it (no CI run from the assembly); if it rejects the hash, the fix is the action's `version: 12.9.1` input or a newer pinned release, recorded then.
4. **Where WP12's tests live.** The repository files' tests are in `apps/api/test/deploy/` (type-checked, cast-checked and aliased like every api test; the image runs that app) and the root scripts' tests in `scripts/*.test.mjs` (decision 49); there is no separate `infra` Vitest project or tsconfig, and `yaml` is an `apps/api` dev dependency. The plan's file map could name `apps/api/test/deploy/` and `scripts/check-backup.mjs` beside the WP12 files.
5. **The pre-migration boot test** previously in this brief is WP8's Task 8.4 (`app.backup.test.ts`, decisions 32, 53); WP12 keeps the deployment-level checks in CI.
6. **The image entry is `apps/api/src/bootstrap/start.ts`** (WP8 brief), while the plan's file map and "Wiring and bootstraps" name `src/bootstrap/app.ts` as the entry; the file map should list `start.ts`.
7. **`pnpm dev` reads no `.env`.** WP8's `dev` script has no `--env-file`, unlike the `tool` script (`--env-file-if-exists=../../.env`), so the setup doc passes `NODE_ENV`, `DATABASE_PATH` and `BIND_ADDRESS` (and the Mailpit settings) through the shell. If WP8 adds `--env-file-if-exists`, the root `.env` written for compose would reach `pnpm dev` too, and the docs would change with it.
8. **WP13's share of `docs/setup.md`** (decision 63): a smoke-test section (curl from the host to `POST /api/tools/smoke` with `curl -u operator` so the password is prompted, and `pnpm smoke:live --origin … --destination …` on a development checkout), the exit codes 2 and 3 in section 10 with `pnpm smoke:live` in its list of entry points, and the change to `docs.test.ts` ("leaves the smoke test to WP13", and the exit-code test's expected set) that admits them.
