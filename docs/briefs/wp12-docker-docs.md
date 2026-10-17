---
wp: 12
title: Docker, compose, env, backup, docs
owner: sonnet
depends_on: [8, 9, 11]
spec_sections: ["§1", "§4 auth", "§5.5", "§7 Migrations, app_lock", "§8.2", "§8.3", "§11 banned words", "§12", "§13", "§14", "§9 item 8"]
reviewers: [code-architect, test-strategy-reviewer, devops-reviewer, security-reviewer, cost-and-budget-reviewer, persona-flexible-traveller]
status: draft
---

<!-- Refreshed 2026-10-17 against spec revision 25, plan decisions 1–61 and the code on main at 0bd717c (WP0–WP7, WP4b merged), with the WP8, WP9, WP11 and WP13 briefs for what is not on main yet. -->

# WP12: Docker, compose, env, backup, docs

## 1. Goal

Ship the one-container deployment (a non-root image, a compose file with an environment allowlist, the final `.env.example`), the on-demand backup CLI over `@gmt/db` `backupDatabase`, a CI job that boots the image and proves its backup and its one-app-per-volume rule, and the three operator documents, each held to the code by a test: the preset table and the cadence table are generated from the functions the app enforces, the exit codes from the one `EXIT` table, the example from the JSON the web app imports.

## 2. Scope

**In**

- `Dockerfile` (three stages on `node:22-slim` pinned by index digest, pnpm through corepack, the fail-closed `better-sqlite3` prebuilt check in every stage, `NODE_ENV=production`, `IN_CONTAINER=1`, `/data` and `/data/backups` owned by `node` before `VOLUME`, no `apt-get`/curl/wget, `HEALTHCHECK` by node fetch of `/api/health`, `USER node`, `CMD` WP8's `apps/api/dist/bootstrap/start.js`) and `.dockerignore` (secrets, local databases, backups, every recorded vendor response (decision 61) and other checkouts out of the build context).
- `scripts/assert-sqlite-prebuilt.mjs`, `scripts/assert-dist-resolution.mjs` (image build assertions) and `scripts/backup.mjs` (the on-demand CLI: arguments, exit codes 0/64/74, one output line), with their tests beside them in the root Vitest project `scripts` (decision 49).
- `docker-compose.yml`: `app` with an explicit environment allowlist built by interpolation (every operator variable of `.env.example`, never `NODE_ENV`, `IN_CONTAINER`, `ALLOW_FIXTURE_PROVIDER` or `FIXTURE_COST_MICRO_GBP`, no `env_file`), named volume, loopback port, no `user:` override; `mailpit` under the `dev` profile for the host-side `pnpm dev` only.
- `.env.example` made byte-equal to the spec §12 block, with a test that keeps it so and that its variables are exactly the ones the config reads (WP4b's `ALL_VARS`).
- `docs/setup.md`, `docs/api-limits.md`, `docs/scheduling.md`, `docs/examples/london-new-york.json` (the worked example, London → New York only).
- The deploy tests in `apps/api/test/deploy/` (type-checked by `apps/api/tsconfig.test.json`, scanned by `pnpm casts`, workspace packages through `vitest.aliases.ts`) and `apps/web/test/example.test.ts` (WP9's constant equals the docs JSON).
- A `docker` job in `.github/workflows/ci.yml`.

**Out**

- The app bootstrap and its entry (`bootApp`, `main`, `start.ts`), `/api/health`, auth, Host checks, the read-only lock wait (decision 53), the backup preflight and its boot test (`app.backup.test.ts`, decision 32), graceful shutdown, the web root (`assetPaths()`), `POST /api/tools/record`: WP8. WP12 does not modify `apps/api/src/`.
- `backupDatabase` (VACUUM INTO, integrity check, refuse-existing, 0700/0600 modes, prune) and its tests: WP3 (on main). The preflight helpers `backupsDirFor`, `BACKUPS_KEPT`, `dataDirRefusal`, the tool bootstrap and the `EXIT` table: WP4b (on main).
- The config schema, `PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`: WP0 (on main). `ALERT_EMAIL_MAX_PER_HOUR`, the one-mailbox and `SMTP_TLS=none` rules and the "email not configured" suppression: WP11. WP12 renders and documents them; it changes none.
- `apps/web/src/example.ts` (`EXAMPLE_DEFINITION`, a JSON import of the docs file) and the boundary script's place-name check and suppression check: WP9 (decisions 36, 46, 49).
- `POST /api/tools/smoke` and `pnpm smoke:live --origin --destination`: WP13. `pnpm record:fixtures`: WP4b (on main). WP12 documents how to run them.
- The secret scan, `pnpm boundaries`, `pnpm casts` and their CI steps: WP0/WP7/WP9 (on main or merged before WP12). WP12 adds no rule to any of them; its new files pass them.

## 3. Spec sections and plan decisions

- **§1.** The docs carry London → New York (LHR, LGW → JFK, EWR) as importable JSON and name no other airport or metro code (a test scans every operator doc against the airports dataset); the £0 path is a three-line `.env`.
- **§4 (auth), §12.** `docs/setup.md` makes the two auth variables the first step; `ALLOWED_HOSTS` for every hostname typed, with Tailscale and reverse-proxy examples; `TRUST_PROXY` only behind a proxy that is the only way in; basic auth beyond loopback needs TLS.
- **§5.5, §9 item 8.** The Dockerfile sets `NODE_ENV=production` and `IN_CONTAINER=1`; compose never passes `NODE_ENV`, `IN_CONTAINER`, `ALLOW_FIXTURE_PROVIDER` (nor the test-only `FIXTURE_COST_MICRO_GBP`) and has no `env_file`.
- **§7 Migrations, `app_lock`; decisions 32, 53.** Backups live in `<dirname(DATABASE_PATH)>/backups` (`/data/backups`), the directory both bootstraps and `scripts/backup.mjs` use, 5 kept; a second live app on the same database waits 90 s and exits 75; the `HEALTHCHECK` start period (240 s) covers that wait, the backup, migrations and seeding.
- **§8.2; decisions 25, 34.** `docs/scheduling.md` carries cron examples, pausing, missed firings and the cadence table, **generated** from the engine's `estimate` and `budgetFit` (Travelpayouts one free call per airport pair and month, never a metro; `runsPerMonth` unrounded); a test regenerates it.
- **§8.3; decisions 56, 59.** `docs/setup.md` documents the SMTP settings (all or nothing; `implicit`/`starttls`; `none` loopback-only, so never in the container), one mailbox per address, `ALERT_EMAIL_MAX_PER_HOUR`, `APP_BASE_URL`, and "email not configured" suppression.
- **§11.** No banned word in any operator doc (core's `findBannedWords` with the one `BANNED_WORD_ALLOWLIST`).
- **§12.** `.env.example` is the §12 block verbatim; the full preset table lives in `docs/api-limits.md`, generated from `PLAN_PRESETS` and `TRAVELPAYOUTS_DEFAULTS`.
- **§13.** Every Dockerfile, `.dockerignore`, compose, backup/restore, local-dev and docs rule listed there; the image has no curl (decision 12): the smoke test is called from the host.
- **§14.** pino JSON to stdout; compose bounds the json-file log (10 MB × 5).
- **Decision 61** (replaces decisions 20 and 26 where they call the recorded tree committed). Recorded vendor responses are local-only and never committed: `.gitignore` (on main) ignores `packages/providers/fixtures/recorded/**/*.json` except our own `params-*.json` allowlists; `.dockerignore` keeps the whole recorded tree and raw bodies out of the image; `docs/setup.md` says so in its operations section (8) and its "Publishing the repository" paragraph (2), and a test holds both.
- **Decision 26.** Tools run as the app's user: the image's `USER node` covers `docker compose exec`/`run`; compose sets no `user:`; the docs forbid `--user root` and say why (the read-only lock probe can leave `-wal`/`-shm` side files).
- **Decisions 48, 49.** `pnpm casts` and `pnpm boundaries` run in CI's `test` job, which the `docker` job needs; WP12's TypeScript tests contain no cast (YAML is parsed through a zod schema) and no suppression comment; root-script tests are `scripts/*.test.mjs`.
- **Decision 13** (dependencies) is extended by §13 item 2: WP12 also depends on WP11.

## 4. Interfaces consumed

As the code on main declares them, plus the WP8, WP9, WP11 and WP13 briefs for what is not merged yet (marked).

```ts
// @gmt/core (WP0–WP2, on main)
export const PENCE_TO_MICRO = 10_000;
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
export const MIGRATIONS_DIR: string; export const AIRPORTS_DATA_DIR: string;   // ../drizzle and ../data beside src/ or dist/
export function loadAirportsDataset(dir: string): AirportsDataset;            // { version; airports: Array<{ iata; … }>; metros: Record<string, string[]> }
export function seedAirports(db: Db, dataset: AirportsDataset): { inserted: number; datasetVersion: string };

// @gmt/engine (WP7, on main)
export function createEngine(deps: EngineDeps, options?: EngineOptions): Engine;   // EngineDeps = Ports minus secrets/recorder/fixtureRoot, plus notifiers
// Engine.estimate(definition: DefinitionInput | SearchDefinition, todayLondon: IsoDate): Estimate   (worst case without reuse, `blocked` filled)
// Engine.budgetFit(definition): { fits; runsPerMonth /* firings in the next 365 days ÷ 12, unrounded */; perScope: Array<{ scope /* 'provider-month:searchapi' … */; estimated; cap; fits }> }

// apps/api (WP4b, on main)
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; migrationsDir: string; … }): Ports;   // src/wiring.ts
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
export const EXIT = { ok: 0, failed: 1, usage: 64, spendRefused: 65, refusedTestEnv: 70, preflightImpossible: 73, backupFailed: 74, lockRefused: 75, badConfig: 78 } as const;   // src/tools/types.ts: the plan's single table
// src/bootstrap/preflight.ts: backupsDirFor(databasePath) = join(dirname(databasePath), 'backups'); BACKUPS_KEPT = 5
// test/helpers/env.ts: ALL_VARS (every variable parseConfig reads), cleanEnv(overrides), SENTINEL_SA, SENTINEL_TP, silentLog
// package.json (root): "record:fixtures": "pnpm -C apps/api run tool record"; tool usage
//   `pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--out DIR] [--dry-run] [--confirm-rerun]`

// apps/api (WP8 brief, not on main)
// src/bootstrap/start.ts: the process entry (the image CMD runs dist/bootstrap/start.js); main(env) exits with BootError.exitCode from EXIT
// src/bootstrap/paths.ts: assetPaths().webRoot = new URL('../../../web/dist/', import.meta.url) → apps/web/dist beside apps/api/dist
// GET /api/health: public and Host-exempt, { ok, degraded }; waitForLockFree: 60 s behind a tool lock, 90 s behind an app lock, then 75
// SIGTERM: stop accepting → engine.shutdown() → wal_checkpoint(TRUNCATE) → lock release → exit 0
// "dev": "node --conditions=@gmt/source --import tsx --watch src/bootstrap/start.ts"   (no --env-file: the environment comes from the shell)

// apps/web (WP9 brief, not on main)
// src/example.ts: import example from '../../../docs/examples/london-new-york.json' with { type: 'json' };
//   export const EXAMPLE_DEFINITION = apiContract.definitionCreateRequestSchema.parse(example);

// WP11 brief (not on main): Config.alertEmailMaxPerHour from ALERT_EMAIL_MAX_PER_HOUR (default 20), added to ALL_VARS;
//   ALERT_EMAIL_TO/FROM one mailbox each; SMTP_TLS=none only for a loopback host (or `mailpit` under development);
//   with no SMTP an alert reaches the log only and its event is recorded `suppressed` ("email not configured").
// WP13 brief (not on main): POST /api/tools/smoke { origin, destination } → { exitCode, summary, lines, fixturesWritten };
//   `pnpm smoke:live --origin X --destination Y`; exit codes 0, 1, 2, 3, 64.
```

## 5. Interfaces produced

- **Image** `get-me-there:local` (compose) / `get-me-there:ci` (CI): runs as `node` (uid 1000), `NODE_ENV=production`, `IN_CONTAINER=1`, data in the volume at `/data`, backups in `/data/backups` (0700), port 3000, health by `GET /api/health`.
- **CLI** `node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n ≥ 1>]`: defaults `DATABASE_PATH` (else `/data/get-me-there.db`), `<dirname(db)>/backups`, 5. Exit 0 prints exactly one line `{"ok":true,"file":"…"}`; 64 on bad arguments (stderr starts `usage: node scripts/backup.mjs`, stdout empty); 74 `backup failed: <cause>` for every failure of the routine (missing database, not a database, world-writable directory, existing target). No exports.
- **CLI** `node scripts/assert-sqlite-prebuilt.mjs`: exit 0 prints `better-sqlite3 13.0.3 prebuilt ok: <path>`; exit 1 lists every failure. **CLI** `node scripts/assert-dist-resolution.mjs`: exit 0 prints `workspace packages resolve to dist`; exit 1 names each package that resolved elsewhere or not at all.
- **`docs/examples/london-new-york.json`**: the importable example, a `definitionCreateRequestSchema`-valid object. Contract with WP9: `apps/web/src/example.ts` imports it; Task 12.8 asserts equality. WP9 writes a byte-identical stand-in only if the file is absent.
- **Doc markers** later packages may rely on: `<!-- preset-table:start/end -->` (api-limits.md), `<!-- cadence-table:start/end -->` (scheduling.md), `<!-- example-definition:start/end -->` and `## 10. Exit codes` … `## 11.` (setup.md).
- **Test helpers** `apps/api/test/deploy/files.ts` (`REPO`, `SPEC_PATH`, `read`, `between`, `dockerfileStages`, `envExampleVariables`, `specEnvBlock`), `presetTable.ts` (`ROWS`, `renderPresetTable`), `cadence.ts` (`CADENCE_DAY`, `exampleInput`, `cadenceCases`, `renderCadenceTable`).

## 6. Library notes

Verified on 2026-10-14 (images, better-sqlite3, Dockerfile and compose syntax) and re-exercised on 2026-10-17 by this revision's assembly (everything except a Docker build: the Docker daemon was not running, so the Dockerfile was verified statically; `docker compose config` was run, which needs no daemon).

- **Base image `node:22-slim`**: `docker buildx imagetools inspect node:22-slim` returned the multi-platform index digest `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` on 2026-10-14 (image created 2026-10-06, `NODE_VERSION=22.23.3`, Debian bookworm-slim). Pin the **index** digest (the top-level `Digest:` line) so arm64 hosts get the same release. The root `package.json` requires Node `>=22.18`. Task 12.1 Step 4 re-inspects it; if it changed, copy the new top-level digest into every `FROM`, the Dockerfile comment and this paragraph. The image has no curl or wget, and nothing is installed from Debian.
- **better-sqlite3 13.0.3** (`packages/db`): lockfile integrity `sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==` (present in `pnpm-lock.yaml` on main). The tarball ships `prebuilds/{linux,linuxmusl,darwin,win32}-{x64,arm64}.node`, has no `install` script and `"gypfile": false` (re-checked in `node_modules` on 2026-10-17), so pnpm never runs node-gyp; `lib/binding.js` falls back to `build/Release/better_sqlite3.node` only when no prebuilt matches. Fail-closed therefore means: the prebuilt exists, `build/` does not, the module loads (`scripts/assert-sqlite-prebuilt.mjs`). `pnpm-workspace.yaml` uses pnpm 12's `allowBuilds` (`better-sqlite3: true`, `esbuild: true`); WP12 does not change it.
- **pnpm 12.9.1 via corepack**: Node 22 bundles corepack; `corepack enable pnpm` installs the shim; the version comes from `"packageManager": "pnpm@12.9.1"`; `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` suppresses the prompt; the Dockerfile fails the build if the resolved version differs. `pnpm install --frozen-lockfile --prod --filter "@gmt/api..."` installs `@gmt/api` and its workspace dependencies' production trees only.
- **Dockerfile syntax** (context7 `/docker/docs`, "HEALTHCHECK"): `--interval` (default 30s), `--timeout`, `--start-period` (failures inside it do not count), `--retries`; exec form `CMD ["node", "-e", "…"]`; multi-stage `FROM … AS name`, `COPY --from=name` (symlinks are copied as links, which keeps pnpm's workspace links); `RUN --mount=type=cache` (BuildKit). A fresh named volume takes the ownership and mode of the image directory it is mounted on, hence `/data` is prepared before `VOLUME`. `.dockerignore` patterns match from the context root unless written `**/…`.
- **Compose** (context7 `/docker/docs`, "variable interpolation"; Docker Compose v5.5.0 locally): `${VAR:-default}` resolves from the shell, then `--env-file`, then the project `.env`; only the names under `environment:` reach the container, unlike `env_file:`. `docker compose --env-file /dev/null config --format json` on the assembly gave 55 `app` variables, `DATABASE_PATH=/data/get-me-there.db`, empty strings for unset ones (the config treats empty as unset) and no `mailpit` without `--profile dev`.
- **Mailpit** (`dev` profile only): `axllent/mailpit@sha256:94f6b70c1436defae6799d9ac7ff0eeff9540465b842026d5cdb018f1c0234ea` (inspected 2026-10-14, image created 2026-10-11); SMTP on 1025, web UI on 8025.
- **yaml 2.9.1** (new `apps/api` dev dependency; npm integrity `sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==`, checked with `npm view` on 2026-10-17): `import { parse } from 'yaml'`; `parse(str)` returns plain objects, throws on a syntax error (context7 `/eemeli/yaml`, "YAML.parse"). Its result is `unknown` to the tests and goes through a zod schema (no cast).
- **zod 4.6.7** (already an `apps/api` dependency): `z.looseObject`, `z.object`, `z.record(z.string(), …)`, `.parse`.
- **Vitest 5.0.4**: the `api` project (aliases from `vitest.aliases.ts`, WP4b's network guards in `test/support/setup.ts`) runs `test/deploy/**`; the root `scripts` project (decision 49; inline in the root `vitest.config.ts` on main, or `scripts/vitest.config.mjs` after WP9 — both include `scripts/*.test.mjs`) runs the script tests; the `web` project runs under jsdom, whose `URL` class `node:fs` does not accept, so the web test builds plain paths.

## 7. Files

- **Create:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/assert-sqlite-prebuilt.mjs`, `scripts/assert-dist-resolution.mjs`, `scripts/backup.mjs`, `docs/setup.md`, `docs/api-limits.md`, `docs/scheduling.md`, `docs/examples/london-new-york.json` (overwrites WP9's stand-in with identical bytes if present).
- **Test:** `scripts/assert-sqlite-prebuilt.test.mjs`, `scripts/backup.test.mjs`; `apps/api/test/deploy/files.ts`, `dockerfile.test.ts`, `envExample.test.ts`, `compose.test.ts`, `presetTable.ts`, `apiLimits.test.ts`, `cadence.ts`, `scheduling.test.ts`, `docs.test.ts`; `apps/web/test/example.test.ts`.
- **Modify:** `.env.example` (generated from spec §12), `apps/api/package.json` (dev dependency `yaml` 2.9.1), `pnpm-lock.yaml`, `.github/workflows/ci.yml` (the `docker` job).

## 8. Tasks

Per-task test runs use `pnpm --filter @gmt/api exec vitest run <files>` (no coverage threshold on a partial run, decision 8) and `pnpm vitest run --project scripts`.

### Task 12.1: Dockerfile, `.dockerignore` and the image assertions (first failing test)

**Files:**
- Create: `apps/api/test/deploy/files.ts`, `Dockerfile`, `.dockerignore`, `scripts/assert-sqlite-prebuilt.mjs`, `scripts/assert-dist-resolution.mjs`
- Test: `apps/api/test/deploy/dockerfile.test.ts`, `scripts/assert-sqlite-prebuilt.test.mjs`

**Interfaces:**
- Consumes: `pnpm-lock.yaml`; WP8's `apps/api/src/bootstrap/start.ts` and `assetPaths()` layout; the build outputs `packages/*/dist`, `apps/api/dist`, `apps/web/dist`; `packages/db/drizzle`, `packages/db/data`.
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

  it('copies migrations, the airports dataset, scripts and the web build into the runtime image', () => {
    for (const path of [
      '/app/packages/db/drizzle',
      '/app/packages/db/data',
      '/app/scripts',
      '/app/apps/web/dist',
    ]) {
      expect(runtime.some((i) => i.startsWith('COPY --from=build ') && i.includes(` ${path} `))).toBe(true);
    }
    expect(runtime.some((i) => i.startsWith('COPY --from=prod-deps /app/node_modules '))).toBe(true);
    expect(runtime.some((i) => /fixtures/.test(i))).toBe(false);
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
  ])('excludes %s', (entry) => {
    expect(lines).toContain(entry);
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
Expected: FAIL while collecting, `ENOENT: no such file or directory, open '…/Dockerfile'`.

Run: `pnpm vitest run --project scripts assert-sqlite-prebuilt`
Expected: the lockfile test PASSES (WP0 pinned it); "passes on this machine" FAILS with status 1 and `Cannot find module '…/scripts/assert-sqlite-prebuilt.mjs'` in stderr.

- [ ] **Step 4: Confirm the base image**

Run: `docker buildx imagetools inspect node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 | head -3` and `docker run --rm node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 sh -c 'corepack --version; command -v curl || echo no-curl'`
Expected: the digest resolves; a corepack version (0.3x.y) and `no-curl`. If corepack is missing or curl is present, stop and report to Fable: the image assumptions are wrong for this digest.

- [ ] **Step 5: Implement**

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
# why node 22: it still bundles corepack; it is the supported runtime of spec §4.
# why no apt-get anywhere: the image carries no curl or wget (spec §13); the health check and the
# operator's tool calls use node's fetch inside and curl on the host.

# ---- build: full install, sqlite assertion, every package and the SPA built ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY . .
RUN corepack enable pnpm \
 && test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
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
 && test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
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
COPY --from=build /app/scripts ./scripts
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
# why: start period 240 s covers the read-only app_lock wait (up to 90 s behind another app's lock,
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

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/dockerfile.test.ts && pnpm vitest run --project scripts assert-sqlite-prebuilt`
Expected: PASS, 23 tests (10 Dockerfile, 13 `.dockerignore`) and 2 tests.

Run: `docker build -t get-me-there:local .` (needs WP8's `start.ts` and WP9's web build on main)
Expected: the log shows `better-sqlite3 13.0.3 prebuilt ok: /app/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/prebuilds/linux-x64.node` three times (`linux-arm64.node` on arm64 hosts) and `workspace packages resolve to dist`, and ends `naming to docker.io/library/get-me-there:local`. Then `docker run --rm --entrypoint id get-me-there:local -u` prints `1000`.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore scripts/assert-sqlite-prebuilt.mjs scripts/assert-sqlite-prebuilt.test.mjs scripts/assert-dist-resolution.mjs apps/api/test/deploy
git commit -m "wp12: non-root Dockerfile with production flags, digest pin and fail-closed sqlite prebuilt"
```

### Task 12.2: `.env.example` equal to spec §12 and to the config's variables

**Prerequisite (§13 item 2):** spec §12 carries the `ALERT_EMAIL_MAX_PER_HOUR` line below, after `ALERT_EMAIL_FROM=` (spec revision 26), and WP11 is on main (its `ALL_VARS` entry). If either is missing, stop and report to Fable; do not edit the spec or `ALL_VARS` from this branch.

```
ALERT_EMAIL_MAX_PER_HOUR=20              # outgoing emails an hour, alerts and operator messages; beyond it they are logged and dropped
```

**Files:**
- Modify: `.env.example`
- Test: `apps/api/test/deploy/envExample.test.ts`

**Interfaces:**
- Consumes: `ALL_VARS` (WP4b `apps/api/test/helpers/env.ts`, extended by WP11), `envExampleVariables`, `specEnvBlock` (Task 12.1).

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
Expected: FAIL on "is the spec §12 block verbatim": WP0's file starts with an extra header line (`# Every variable from the design spec §12. …`) and lacks the `ALERT_EMAIL_MAX_PER_HOUR` line; FAIL on the variable set (missing `ALERT_EMAIL_MAX_PER_HOUR`). The credential test passes.

- [ ] **Step 3: Implement**

Run: `node -e "const fs=require('node:fs');const s=fs.readFileSync('docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md','utf8').split('## 12. Configuration')[1];const a=s.indexOf('\`\`\`\n')+4;const b=s.indexOf('\n\`\`\`',a);fs.writeFileSync('.env.example',s.slice(a,b)+'\n')"`

`// why:` generating the file from the spec removes any hand-copy drift; the test keeps it equal from now on. Never run this against a file holding real values: `.env.example` holds none, and `.env` is a different file.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/envExample.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/api/test/deploy/envExample.test.ts && git commit -m "wp12: .env.example equals spec §12 and names every variable the config reads"
```

### Task 12.3: `docker-compose.yml` with an interpolated environment allowlist

**Files:**
- Create: `docker-compose.yml`
- Modify: `apps/api/package.json` (dev dependency `yaml` 2.9.1), `pnpm-lock.yaml`
- Test: `apps/api/test/deploy/compose.test.ts`

**Interfaces:**
- Consumes: `envExampleVariables` (Task 12.1), `.env.example` (Task 12.2).
- Produces: services `app` and `mailpit`, volume `gmt-data` (Docker names it `get-me-there_gmt-data`).

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
/** Values compose fixes because the image layout or the published port depends on them. */
const FIXED: Readonly<Record<string, string>> = {
  DATABASE_PATH: '/data/get-me-there.db',
  PORT: '3000',
  BIND_ADDRESS: '0.0.0.0',
};

describe('docker-compose.yml app service (spec §13, §5.5)', () => {
  it('passes an explicit allowlist: every .env.example variable except the never-passed ones, and nothing else', () => {
    const expected = envExampleVariables(read('.env.example')).filter((n) => !NEVER.includes(n));
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
      ALLOW_UNAUTHENTICATED: "${ALLOW_UNAUTHENTICATED:-}"
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
Expected: PASS (9 tests); `config --quiet` prints nothing and exits 0. (`--env-file /dev/null` keeps any real `.env` out of the check; never run `docker compose config` without `--quiet` against a real `.env`, because it prints the interpolated values.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/api/package.json pnpm-lock.yaml apps/api/test/deploy/compose.test.ts && git commit -m "wp12: compose with interpolated environment allowlist and host-dev mailpit"
```

### Task 12.4: `scripts/backup.mjs`, a CLI wrapper around `@gmt/db` `backupDatabase`

**Files:**
- Create: `scripts/backup.mjs`
- Test: `scripts/backup.test.mjs`

**Interfaces:**
- Consumes: `backupDatabase` (WP3, built `@gmt/db`), `systemClock` (built `@gmt/core`), the exit-code table (`EXIT`: 0, 64, 74), the backups directory rule `<dirname(db)>/backups` and keep count 5 (WP4b preflight).
- Produces: the CLI of §5. It owns argument parsing, exit codes and its one output line; the VACUUM INTO, integrity check, modes, refuse-existing and pruning are WP3's routine.

- [ ] **Step 1: Write the failing test**

`scripts/backup.test.mjs`:

```js
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// why: decision 49 keeps tests of root scripts beside them, run by the root Vitest project `scripts`. The CLI owns
// arguments, exit codes and its one output line; VACUUM INTO, integrity_check, refuse-existing and pruning are WP3's
// backupDatabase and are tested there.
const REPO = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(REPO, 'scripts', 'backup.mjs');
const NAME = /^get-me-there-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;
const Database = createRequire(join(REPO, 'packages', 'db', 'package.json'))('better-sqlite3');

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// why: the CLI loads the built @gmt/db and @gmt/core (as it does in the image), so they are built first.
beforeAll(() => {
  execFileSync('pnpm', ['--filter', '@gmt/db...', 'build'], { cwd: REPO, stdio: 'ignore' });
}, 240_000);

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

/** @param {string[]} args @param {Record<string, string>} [env] */
function cli(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

/** @param {string} dir */
function backups(dir) {
  return readdirSync(dir).filter((f) => NAME.test(f));
}

describe('scripts/backup.mjs (spec §13 Backup; the plan’s exit-code table)', () => {
  it('exits 0 and prints one JSON line naming the new file, a private copy in a private directory', () => {
    const dir = tempDir();
    const r = cli(['--db', sampleDb(dir), '--dir', join(dir, 'b')]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toHaveLength(2);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(existsSync(out.file)).toBe(true);
    expect(backups(join(dir, 'b'))).toHaveLength(1);
    expect(statSync(join(dir, 'b')).mode & 0o777).toBe(0o700);
    expect(statSync(out.file).mode & 0o777).toBe(0o600);
    const copy = new Database(out.file, { readonly: true });
    expect(copy.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
    copy.close();
  });

  it('defaults to DATABASE_PATH and <dirname(DATABASE_PATH)>/backups, the bootstraps’ directory', () => {
    const dir = tempDir();
    const r = cli([], { DATABASE_PATH: sampleDb(dir) });
    expect(r.status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(1);
  });

  it('keeps the newest 5 by default and forwards --keep', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    for (let i = 0; i < 7; i++) expect(cli(['--db', db]).status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(5);
    expect(cli(['--db', db, '--keep', '2']).status).toBe(0);
    expect(backups(join(dir, 'backups'))).toHaveLength(2);
  });

  it('exits 74 with the cause when the file is not a database, and leaves no copy', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    writeFileSync(db, 'this is not a database file '.repeat(200));
    const r = cli(['--db', db]);
    expect(r.status).toBe(74);
    expect(r.stderr).toMatch(/^backup failed: .*file is not a database/);
    expect(backups(join(dir, 'backups'))).toHaveLength(0);
  });

  it('exits 74 when the database file does not exist, creating nothing', () => {
    const dir = tempDir();
    const r = cli(['--db', join(dir, 'absent.db')]);
    expect(r.status).toBe(74);
    expect(r.stderr).toMatch(/^backup failed: backup refused: .*absent\.db does not exist/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('exits 74 when the backups directory is world-writable', () => {
    const dir = tempDir();
    const b = join(dir, 'b');
    mkdirSync(b);
    chmodSync(b, 0o777);
    const r = cli(['--db', sampleDb(dir), '--dir', b]);
    expect(r.status).toBe(74);
    expect(r.stderr).toMatch(/^backup failed: backup refused: .* is world-writable/);
  });

  it.each([
    [['--force']],
    [['--db']],
    [['--db', '--keep']],
    [['--keep', '0']],
    [['--keep', 'two']],
    [['--keep', '1.5']],
    [['--db', 'a', '--db', 'b']],
  ])('exits 64 on bad arguments %j', (args) => {
    const r = cli(args);
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/^usage: node scripts\/backup\.mjs/);
    expect(r.stdout).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project scripts backup`
Expected: FAIL in all 13 tests: each spawn exits 1 with `Cannot find module '…/scripts/backup.mjs'`.

- [ ] **Step 3: Implement**

`scripts/backup.mjs`:

```js
#!/usr/bin/env node
// On-demand SQLite backup for get-me-there. Spec §13 "Backup".
//   docker compose exec -T app node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n>]
// A thin wrapper: the VACUUM INTO + integrity_check + refuse-existing + prune routine is @gmt/db `backupDatabase`
// (WP3), the one both bootstraps call through apps/api's preflight before migrating (plan decision 32), with the same
// directory (<dirname(db)>/backups) and keep count (5). Exit codes are the plan's single table: 0 ok, 64 usage,
// 74 backup failed. Run it as the app's user (the image's `node`), never as root (plan decision 26).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXIT_OK = 0;
const EXIT_USAGE = 64;
const EXIT_BACKUP_FAILED = 74;
const DEFAULT_KEEP = 5;
const DEFAULT_DB = '/data/get-me-there.db';
const USAGE = 'usage: node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n ≥ 1>]';

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {string | undefined} envDb
 * @returns {{ db: string; dir: string; keep: number }}
 */
function parseArgs(argv, envDb) {
  /** @type {Map<string, string>} */
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] ?? '';
    const value = argv[i + 1];
    if (!['--db', '--dir', '--keep'].includes(name)) throw new UsageError(`unknown argument ${name}`);
    if (flags.has(name)) throw new UsageError(`${name} is given twice`);
    if (value === undefined || value === '' || value.startsWith('--'))
      throw new UsageError(`${name} needs a value`);
    flags.set(name, value);
  }
  const keepRaw = flags.get('--keep') ?? String(DEFAULT_KEEP);
  const keep = Number(keepRaw);
  if (!/^\d+$/.test(keepRaw) || !Number.isSafeInteger(keep) || keep < 1)
    throw new UsageError(`--keep must be a positive integer, got ${keepRaw}`);
  // why: an operator tool outside the packages reads DATABASE_PATH itself; compose fixes it to /data/get-me-there.db.
  const db = flags.get('--db') ?? (envDb !== undefined && envDb !== '' ? envDb : DEFAULT_DB);
  return { db, dir: flags.get('--dir') ?? join(dirname(db), 'backups'), keep };
}

/**
 * The built @gmt/db and @gmt/core, through apps/api's dependency links, which exist in the repository after
 * `pnpm build` and in the image. why: scripts/ is not a workspace package, so a bare import would not resolve.
 */
async function loadPackages() {
  const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const db = await import(pathToFileURL(requireFromApi.resolve('@gmt/db')).href);
  const core = await import(pathToFileURL(requireFromApi.resolve('@gmt/core')).href);
  return { backupDatabase: db.backupDatabase, systemClock: core.systemClock };
}

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), process.env.DATABASE_PATH);
  } catch (err) {
    process.stderr.write(`${USAGE}\n${message(err)}\n`);
    return EXIT_USAGE;
  }
  try {
    const { backupDatabase, systemClock } = await loadPackages();
    // why: backupDatabase refuses a missing database, an existing target and a world-writable directory itself.
    const r = backupDatabase(args.db, args.dir, { keep: args.keep, clock: systemClock });
    process.stdout.write(`${JSON.stringify({ ok: true, file: r.file })}\n`);
    return EXIT_OK;
  } catch (err) {
    process.stderr.write(`backup failed: ${message(err)}\n`);
    return EXIT_BACKUP_FAILED;
  }
}

process.exitCode = await main();
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --project scripts backup`
Expected: PASS (13 tests: 6 behaviours, 7 bad-argument cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/backup.mjs scripts/backup.test.mjs && git commit -m "wp12: backup CLI over @gmt/db backupDatabase with the shared exit codes"
```

### Task 12.5: `docs/api-limits.md` with the generated preset table

**Files:**
- Create: `docs/api-limits.md`
- Test: `apps/api/test/deploy/presetTable.ts`, `apps/api/test/deploy/apiLimits.test.ts`

**Interfaces:**
- Consumes: `PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`, `PENCE_TO_MICRO`, `PlanPreset` (WP0).
- Produces: `ROWS`, `renderPresetTable()`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/deploy/presetTable.ts`:

```ts
// The docs/api-limits.md preset table, rendered from core's PLAN_PRESETS and TRAVELPAYOUTS_DEFAULTS (spec §12: "the
// full preset table lives in docs/api-limits.md and the zod schema"), so the doc and the code cannot drift.
import { PENCE_TO_MICRO, PLAN_PRESETS, type PlanPreset, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';

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
  if (unit === 'microGbp') return `${String(value)} µGBP (${Number(value) / PENCE_TO_MICRO}p)`;
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
import { between, read } from './files.js';
import { ROWS, renderPresetTable } from './presetTable.js';

describe('docs/api-limits.md preset table (spec §12)', () => {
  it('covers every preset field of every plan and every Travelpayouts default', () => {
    const fields = ROWS.map((r) => r.field).sort();
    expect(fields).toEqual(Object.keys(PLAN_PRESETS.trial).sort());
    expect(fields).toEqual(Object.keys(PLAN_PRESETS['40usd']).sort());
    for (const key of Object.keys(TRAVELPAYOUTS_DEFAULTS)) expect(fields).toContain(key);
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
Expected: the coverage test PASSES; "matches the table" FAILS with `ENOENT … docs/api-limits.md`.

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
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add docs/api-limits.md apps/api/test/deploy && git commit -m "wp12: api-limits doc with the preset table generated from PLAN_PRESETS"
```

### Task 12.6: `docs/scheduling.md` with the cadence table generated from the engine

**Files:**
- Create: `docs/scheduling.md`, `docs/examples/london-new-york.json`
- Test: `apps/api/test/deploy/cadence.ts`, `apps/api/test/deploy/scheduling.test.ts`

**Interfaces:**
- Consumes: `buildPorts`, `loadConfigFromEnv` (WP4b), `cleanEnv`, `SENTINEL_SA`, `SENTINEL_TP`, `silentLog` (WP4b test helpers), `seedAirports`, `loadAirportsDataset`, `AIRPORTS_DATA_DIR`, `MIGRATIONS_DIR` (WP3), `createEngine` → `estimate`, `budgetFit` (WP7), `definitionCreateRequestSchema` (WP0).
- Produces: `CADENCE_DAY`, `exampleInput()`, `cadenceCases()`, `renderCadenceTable()`; the example JSON.

Rule (spec §8.2, decisions 25, 34): every number in the table is the engine's: calls a run are `Estimate.perProvider[].planCalls` and `.calls` (with the retry factor), runs a month `BudgetFit.runsPerMonth` unrounded (shown to two places), calls a month the `provider-*` scopes of `budgetFit` (which count a calendar fetch once per refresh period, so a daily schedule does not refetch calendars daily), a provider absent from those scopes is shown as left out of scheduled runs, and `Fits` is `budgetFit.fits`. The engine runs over in-memory ports with sentinel credentials and the default limits, on a fixed day, so the table is deterministic and makes no network call (the api project's guards refuse any).

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
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { createEngine } from '@gmt/engine';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_SA, SENTINEL_TP, silentLog } from '../helpers/env.js';
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
  const env = cleanEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
    ...(c.plan === 'none' ? {} : { SEARCHAPI_KEY: SENTINEL_SA, SEARCHAPI_PLAN: c.plan }),
  });
  const clock = fixedClock(asIsoDateTime(`${CADENCE_DAY}T09:00:00.000Z`));
  const ports = buildPorts(loadConfigFromEnv(env), { log: silentLog, clock, migrationsDir: MIGRATIONS_DIR });
  try {
    seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
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
  } finally {
    ports.db.close();
  }
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

If the engine on main has changed since 2026-10-17 and the table differs, regenerate it from `renderCadenceTable()` (print it from a scratch test), paste it between the markers, and report the changed numbers to Fable: the prose above the table and §13 item 3 quote them.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy/scheduling.test.ts`
Expected: PASS (2 tests, about 2 s: five in-memory engines, each seeding the airports dataset).

- [ ] **Step 6: Commit**

```bash
git add docs/scheduling.md docs/examples apps/api/test/deploy && git commit -m "wp12: scheduling doc with the cadence table generated from the engine's estimate and budgetFit"
```

### Task 12.7: `docs/setup.md`; the example, exit codes, banned words and the worked-example-only rule

**Files:**
- Create: `docs/setup.md`
- Test: `apps/api/test/deploy/docs.test.ts`

**Interfaces:**
- Consumes: `EXIT` (WP4b), `definitionCreateRequestSchema`, `findBannedWords`, `BANNED_WORD_ALLOWLIST` (WP0), `loadAirportsDataset`, `AIRPORTS_DATA_DIR` (WP3).

Rules: recordings are local-only (decision 61: `.gitignore` carries the two lines, `setup.md` says so and has its "Publishing the repository" paragraph, no operator doc calls the recorded tree committed); the JSON block in `setup.md` is the example file byte for byte; the exit-code table lists exactly `EXIT`'s values plus the smoke test's 2 and 3; no operator doc holds a banned word; no operator doc or the example names an airport or metro code (any `\b[A-Z]{3}\b` token in the airports dataset or `metros.json`) other than LHR, LGW, JFK, EWR, LON, NYC, with a committed list of capitalised words that collide with codes (`NOT_PLACES`), extended only with a word, never a place.

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
  it('lists every code of EXIT plus the smoke test’s 2 and 3, and nothing else', () => {
    const table = between(read('docs/setup.md'), '## 10. Exit codes', '\n## 11.');
    const codes = [...table.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
    expect(codes).toEqual([...new Set([...Object.values(EXIT), 2, 3])].sort((a, b) => a - b));
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
    for (const file of OPERATOR_DOCS)
      expect(read(`docs/${file}`)).not.toMatch(/private-repo|committed recorded|recorded tree is committed/i);
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

  it('the allowlist is needed (setup.md names the smoke script)', () => {
    expect(findBannedWords(read('docs/setup.md')).map((h) => h.word)).toContain('live');
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
Expected: FAIL: the setup.md block and exit-code tests with `ENOENT … docs/setup.md`, the docs-set test (`setup.md` missing from the listing); the example tests and the two existing docs' scans PASS.

- [ ] **Step 3: Implement**

`docs/setup.md`:

````markdown
# Setup

This gets one container running on a machine you control, reachable only by you, with a
backup routine. Everything below uses the worked example London → New York; put your own
airports in the Definitions form, never in a file of this repository.

## 1. Authentication first

The container listens on all interfaces inside Docker, compose publishes it on
`127.0.0.1:3000` only, and the app refuses to start without basic auth in that setup. Create
`.env` next to `docker-compose.yml`:

```dotenv
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=choose-a-long-passphrase
```

The password needs at least 12 characters. If a value contains `$`, wrap it in single quotes
(`'pa$$phrase-example'`), because compose interpolates `$` in `.env`.

Basic auth sends the password with every request. Over plain HTTP that is only acceptable on
loopback. To reach the app from another device, put TLS in front of it (section 3).

## 2. The £0 configuration: three lines

Get a free Travelpayouts token (Travelpayouts account → API token) and add it:

```dotenv
TRAVELPAYOUTS_TOKEN=your-travelpayouts-token
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=choose-a-long-passphrase
```

That is the whole `.env` for £0. Then:

```bash
docker compose up -d --build
docker compose ps          # wait for "healthy"; the first boot can take up to 4 minutes
```

Open <http://127.0.0.1:3000> and sign in.

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

**Publishing the repository.** The repository holds no key and no vendor response: `.env` and
every recording under `packages/providers/fixtures/recorded/` are ignored by git (only our own
`params-*.json` allowlists are tracked), and the commits that once held recordings were purged.
Before you make it public, check with `git status --ignored` that nothing you added sits outside
those rules, and never force-add a recording.

Never put `NODE_ENV`, `IN_CONTAINER` or `ALLOW_FIXTURE_PROVIDER` in `.env` for the container:
compose does not pass them (the image sets the first two), and fixture data cannot be enabled
in a container.

## 3. Reaching it from other devices: ALLOWED_HOSTS and TLS

The app rejects any request whose `Host` header is not in `ALLOWED_HOSTS`, and the error names
the header value and the variable. The default is `localhost:3000,127.0.0.1:3000`. Setting the
variable replaces the default, so list every hostname you will type in a browser, including
the local ones if you still use them.

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
Keep port 3000 bound to `127.0.0.1` (as compose does) so it is.

`ALLOW_UNAUTHENTICATED=true` exists for a host reachable only over Tailscale and run outside
compose with the app bound to a non-loopback address. With compose, keep auth on.

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
the container; it exists for the local mail catcher of section 11. `ALERT_EMAIL_MAX_PER_HOUR`
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

The database is one file on the named volume, `/data/get-me-there.db` inside the container,
and its backups go to `/data/backups` (the `backups` folder beside `DATABASE_PATH`). The
image runs as the unprivileged user `node` (uid 1000), which owns `/data`; backups are
readable by that user only.

The app backs the database up by itself before applying a schema migration (on an upgrade)
and refuses to start if that backup fails. For routine backups, run the same routine on
demand:

```bash
docker compose exec -T app node scripts/backup.mjs
```

It writes `/data/backups/get-me-there-<UTC timestamp>.db` with SQLite `VACUUM INTO` (safe
while the app runs), checks it with `PRAGMA integrity_check`, refuses to overwrite an existing
file, keeps the newest 5, prints one line `{"ok":true,"file":"…"}`, and exits 74 on any
failure (section 10).

**Copy backups out of the volume** to the host:

```bash
docker compose cp app:/data/backups/. ./backups/
```

(`backups/` is in `.gitignore`.)

**Host cron with retention**, for example in `/etc/cron.d/get-me-there` (adjust the path and
the user that owns the checkout):

```cron
15 3 * * * operator cd /opt/get-me-there && docker compose exec -T app node scripts/backup.mjs >> /var/log/get-me-there-backup.log 2>&1 && docker compose cp app:/data/backups/. /var/backups/get-me-there/ && find /var/backups/get-me-there -name 'get-me-there-*.db' -mtime +30 -delete
```

That keeps 5 copies in the volume and 30 days of copies on the host.

**Off-box copy**: a backup on the same disk does not survive the disk. Send the host copies
elsewhere, for example:

```bash
rsync -a /var/backups/get-me-there/ backup-host:get-me-there/
```

### Restore

1. Stop the app: `docker compose stop app`.
2. Replace the database on the volume and delete its WAL side files, using a throwaway
   container of the same image, which runs as `node` like the app:

   ```bash
   docker compose run --rm --no-deps -v "$PWD/backups":/restore:ro --entrypoint sh app -c '
     rm -f /data/get-me-there.db-wal /data/get-me-there.db-shm &&
     cp /restore/get-me-there-2026-10-14T03-15-00-000Z.db /data/get-me-there.db'
   ```

3. Start: `docker compose start app`.
4. Restoring resets month-to-date spend: ledger rows written after the backup are gone. Lower
   the caps and reconcile with the vendor dashboard before the next run, as described in
   `docs/api-limits.md` ("Restoring a backup resets month-to-date spend").

**Docker Desktop (macOS, Windows):** keep the database on the named volume. Bind-mounting a
host folder over `/data` goes through Docker Desktop's file-sharing layer, where SQLite's WAL
locking is not reliable and the database can be corrupted. Use a bind mount only to copy
backups in or out (as in the restore step above), never for the working database file. On a
Linux host a bind mount works if the directory is owned by uid 1000; the app stops at boot
with exit 73 and a message naming the directory if it cannot write there.

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

## 8. Smoke test and fixture recording

While the app runs it holds the database lock, so the smoke test runs inside the app process
through an authenticated route under `/api`. The image has no `curl`; call it from the host
through the loopback port (curl asks for the password, so it stays out of your shell history):

```bash
curl -u operator -X POST \
  -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -d '{"origin":"LHR","destination":"JFK"}' http://127.0.0.1:3000/api/tools/smoke
```

It issues one request per configured provider for that pair and returns
`{ exitCode, summary, lines, fixturesWritten }` with an exit code from section 10.

Fixture recording is a development task, not an operations one. Recorded vendor responses are
local-only and never committed: SearchApi's results come from Google Flights and Travelpayouts' from the
Aviasales cache, and neither may be republished. Git ignores everything under
`packages/providers/fixtures/recorded/` except our own `params-*.json` parameter allowlists, the
image never contains a recording, and a recording exists only on the disk of the machine that
made it (keep your own private copy outside the repository if you want one). Record on a
development checkout with the app stopped, worked example only (any other route needs
`--out DIR` outside the repository), and look at the plan first with `--dry-run`:

```bash
pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run
pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03
```

Recording spends SearchApi credits up to `--budget` (choose a month inside the next year). On
a development checkout, with the app stopped, the smoke test is
`pnpm smoke:live --origin LHR --destination JFK`.

## 9. One app per database, one user for every process

- **One app.** The app holds a lock in the database while it runs. A second app started on the
  same database (a second compose project on the same volume, or `docker compose run app`
  while `app` is up) waits up to 90 seconds for the first to stop and then exits 75; it never
  takes the lock from a running app. A lock left by an app that died is taken over at once.
- **One user.** Run every command against the database as the app's user, which
  `docker compose exec app …` and `docker compose run app …` do by default (`node`). Never add
  `--user root` or `-u 0`: a check that only reads the database can still leave SQLite's `-wal`
  and `-shm` side files behind, and side files owned by root stop the app from opening its own
  database. On a development checkout, run `pnpm record:fixtures`, `pnpm smoke:live` and
  `pnpm dev` as the same OS user.
- A tool started from the command line while the app runs exits 75 and names the route to use
  instead (`POST /api/tools/…`).

## 10. Exit codes

Every command-line entry point (the app itself, `pnpm smoke:live`, `pnpm record:fixtures`,
`node scripts/backup.mjs`) and the `exitCode` of the `/api/tools/*` routes use this one table:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | a tool run failed (smoke test: a configured provider returned an error; recording: a required call did not return its expected status) |
| 2 | smoke test: no provider is configured |
| 3 | smoke test: the provider answered with no prices |
| 64 | bad arguments (usage), or a recording of another route than the worked example without `--out DIR` outside the repository |
| 65 | recording refused for spend: it would exceed `--budget` with earlier recordings (rerun with `--confirm-rerun`), or a provider's budget window has less room than the run needs |
| 70 | refused because `NODE_ENV=test`, or because fixture data is enabled |
| 73 | the data directory or `<data dir>/backups` is not writable, the database lock cannot be read, or the pre-migration backup cannot be attempted |
| 74 | the backup failed (boot or `scripts/backup.mjs`); migrations were not applied |
| 75 | the database lock is held by another running app or tool |
| 78 | bad configuration; the message names every variable to fix |

With `restart: unless-stopped`, an app that exits 73, 74, 75 or 78 restarts and fails the same
way until you fix the cause; `docker compose logs app` shows the message. The health check's
240-second start period covers the lock wait of section 9, the pre-migration backup, the
migrations and the first airport seeding.

## 11. Local development

```bash
pnpm install
mkdir -p data
NODE_ENV=development DATABASE_PATH="$PWD/data/dev.db" BIND_ADDRESS=127.0.0.1 pnpm dev
pnpm test
docker compose --profile dev up -d mailpit   # optional: catch alert email locally
```

`pnpm dev` runs the api and the web app with hot reload against `data/dev.db` (`data/` is in
`.gitignore`). With Mailpit running, a development environment can send mail to it:

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_TLS=none
SMTP_USER=dev
SMTP_PASS=dev
ALERT_EMAIL_TO=operator@example.com
ALERT_EMAIL_FROM=get-me-there@example.com
```

Messages appear at <http://127.0.0.1:8025>. `SMTP_TLS=none` is accepted only for a loopback
host; the container never uses Mailpit.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api exec vitest run test/deploy`
Expected: PASS: 53 tests in 6 files (dockerfile 23, envExample 3, compose 9, apiLimits 2, scheduling 2, docs 14). A banned-word failure lists `word @index: …context…`: reword the sentence (the allowlist is core's; never add a local one). A place failure names the code: remove it, or, if it is an ordinary word (as `GET` and `PWD` are), add it to `NOT_PLACES` with the doc's sentence in the commit message.

- [ ] **Step 5: Commit**

```bash
git add docs/setup.md apps/api/test/deploy/docs.test.ts && git commit -m "wp12: setup doc; the example, exit codes, banned words and worked-example-only rule held by tests"
```

### Task 12.8: The web app's example constant equals the docs JSON

WP9 is a dependency, so `apps/web/src/example.ts` exists on main (it parses the docs JSON through the create schema at load). This test proves the import and the file agree.

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
Expected: PASS (2 tests). A failure is a WP9 defect: report it to Fable with the diff; do not edit WP9's file from this branch. To see it fail, change `"0 5 * * 1"` to `"0 6 * * 1"` in the JSON copy inside a scratch checkout only.

- [ ] **Step 3: Commit**

```bash
git add apps/web/test/example.test.ts && git commit -m "wp12: the web app's example constant equals the docs JSON"
```

### Task 12.9: The `docker` job in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the image (Task 12.1), compose (Task 12.3), the backup CLI (Task 12.4), `GET /api/health` and the lock wait (WP8).

Rule: the job needs `test`, so `pnpm lint`, `pnpm boundaries`, `pnpm casts`, `pnpm -r typecheck`, the tests with coverage and the secret scan (all already steps of `test`) pass before an image is built. The existing "Dockerfile sets production and container flags" grep step stays.

- [ ] **Step 1: Run the job's commands locally (they fail before Tasks 12.1–12.4)**

Run, from a checkout with WP8 and WP9 on main: the `run:` blocks below in order, by hand.
Expected before the earlier tasks: a failure at the first missing piece. After them: `id -u` is `1000`; the flags check exits 0; the curl/wget probe prints nothing and exits 1; the container reaches `healthy`; `/api/health` prints `{"ok":true,"degraded":false}`; the backup prints `{"ok":true,"file":"/data/backups/get-me-there-….db"}` and `stat` prints `1000 700`; the second app exits 75 after about 90 s with `app_lock` named in its stderr; the stop completes within 30 s.

- [ ] **Step 2: Implement**

Append under `jobs:` in `.github/workflows/ci.yml`, after the `test` job:

```yaml
  docker:
    # Spec §13: the image builds from the lockfile, runs as node with the production flags and no curl, boots to
    # healthy on a fresh volume, backs itself up as node, and refuses a second app on the same volume (decision 53).
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image
        run: docker buildx build --load --tag get-me-there:ci .
      - name: Compose file is valid
        run: docker compose config --quiet
      - name: Image runs as node with the production flags and carries no curl or wget
        run: |
          test "$(docker run --rm --entrypoint id get-me-there:ci -u)" = "1000"
          docker run --rm --entrypoint node get-me-there:ci -e "process.exit(process.env.NODE_ENV === 'production' && process.env.IN_CONTAINER === '1' ? 0 : 1)"
          if docker run --rm --entrypoint sh get-me-there:ci -c 'command -v curl || command -v wget'; then exit 1; fi
      - name: Container boots and becomes healthy on a fresh volume
        run: |
          docker volume create gmt-ci-data
          docker run -d --name gmt-ci -p 127.0.0.1:3000:3000 -v gmt-ci-data:/data \
            -e DATABASE_PATH=/data/get-me-there.db \
            -e APP_BASIC_AUTH_USER=ci -e APP_BASIC_AUTH_PASS=ci-password-0123 \
            get-me-there:ci
          for i in $(seq 1 60); do
            status="$(docker inspect --format '{{.State.Health.Status}}' gmt-ci)"
            [ "$status" = healthy ] && break
            [ "$(docker inspect --format '{{.State.Running}}' gmt-ci)" = true ] || { docker logs gmt-ci; exit 1; }
            sleep 5
          done
          docker logs gmt-ci | tail -n 50
          test "$(docker inspect --format '{{.State.Health.Status}}' gmt-ci)" = healthy
          curl -fsS http://127.0.0.1:3000/api/health
      - name: Backup runs inside the container as node, into /data/backups
        run: |
          docker exec gmt-ci node scripts/backup.mjs
          test "$(docker exec gmt-ci stat -c '%u %a' /data/backups)" = "1000 700"
      - name: A second app on the same volume refuses with 75 (decision 53)
        run: |
          set +e
          docker run --rm -v gmt-ci-data:/data \
            -e DATABASE_PATH=/data/get-me-there.db \
            -e APP_BASIC_AUTH_USER=ci -e APP_BASIC_AUTH_PASS=ci-password-0123 \
            get-me-there:ci
          code=$?
          set -e
          test "$code" = 75
      - name: Stop gracefully within the grace period
        if: always()
        run: docker stop --time 30 gmt-ci && docker rm gmt-ci && docker volume rm gmt-ci-data
```

- [ ] **Step 3: Run to verify it passes**

Push the branch. Expected: the `test` and `docker` jobs are green; the second-app step takes 90–100 s.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "wp12: CI builds the image, boots it healthy, backs up as node and refuses a second app"
```

## 9. Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP12. The WP12-specific risks are pinned by: `compose.test.ts` "never passes NODE_ENV, IN_CONTAINER, ALLOW_FIXTURE_PROVIDER or FIXTURE_COST_MICRO_GBP, and has no env_file" (synthetic gate, §5.5); `dockerfile.test.ts` "runs as the non-root user node from the last RUN onwards" and "installs no package from the distribution" (decisions 26, 12); `assert-sqlite-prebuilt.test.mjs` "pnpm-lock.yaml pins better-sqlite3 13.0.3 to the integrity recorded in the WP12 brief" (fail-closed prebuilt, §4); `scheduling.test.ts` "matches the table the engine computes" (§8.2); `docs.test.ts` "names no airport or metro code but the worked example's" (§1) and "git ignores every recording but our params allowlists" (decision 61); the CI step "A second app on the same volume refuses with 75" (decision 53).

## 10. Definition of done

| Command | Expected |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | `Checked N files … No fixes applied`, exit 0 |
| `pnpm -r typecheck` | exit 0 (the deploy tests through `apps/api/tsconfig.test.json`, the web test through `apps/web/tsconfig.test.json`) |
| `pnpm boundaries` | exit 0 |
| `pnpm casts` | exit 0, `0 casts` |
| `pnpm secret-scan` | `secret scan: clean` |
| `pnpm --filter @gmt/api exec vitest run test/deploy` | 53 tests PASS in 6 files |
| `pnpm vitest run --project scripts` | every script test PASS, including `backup.test.mjs` (13) and `assert-sqlite-prebuilt.test.mjs` (2) |
| `pnpm --filter @gmt/web exec vitest run test/example.test.ts` | 2 tests PASS |
| `pnpm --filter @gmt/api test` | PASS with lines ≥ 85%, branches ≥ 70% (the deploy tests add no `src` file) |
| `pnpm test` | every project PASS |
| `docker build -t get-me-there:local .` | succeeds; `better-sqlite3 13.0.3 prebuilt ok` three times; `workspace packages resolve to dist` |
| `docker compose --env-file /dev/null config --quiet` | exit 0, no output |
| `docker compose up -d && docker compose ps` (with a three-line `.env`) | `app` reaches `healthy` within 240 s |
| `docker compose exec -T app node scripts/backup.mjs` | exit 0, one line `{"ok":true,"file":"/data/backups/…"}` |
| `docker compose exec app id -un` | `node` |
| `docker compose stop app` | stops within 30 s |
| CI on the branch | `test` and `docker` jobs green |

## 11. Open questions

None requires the operator's judgment. §13 item 2 is a prerequisite Fable settles before dispatch (a spec line and the dependency on WP11), not a design question.

## 12. Changes outside WP12's own files

- `apps/api/package.json` and `pnpm-lock.yaml`: dev dependency `yaml` 2.9.1 (Task 12.3).
- New test files in other packages' trees, which change no existing file: `apps/api/test/deploy/*` and `apps/web/test/example.test.ts`.
- `.github/workflows/ci.yml` (WP0's): the `docker` job appended.
- `.env.example` (WP0's): regenerated from spec §12.

## 13. For the plan (not yet recorded there)

1. **Assembly.** On 2026-10-17 every file of this brief was assembled on a detached scratch worktree of main at `4f8e07b` and the brief's code blocks were generated from those files. Stand-ins, in the scratch tree only: a placeholder `apps/api/src/bootstrap/start.ts` (WP8); WP9's `apps/web/src/example.ts` and its `resolveJsonModule` tsconfig edits; WP11's `ALERT_EMAIL_MAX_PER_HOUR` entry in `ALL_VARS`; the item 2 spec line. Results: `pnpm -r typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm casts` (421 files, 0 casts) clean; deploy tests 53, script project 20 (13 backup, 2 prebuilt, 5 WP7 cast tests), web example 2; `pnpm --filter @gmt/api test` 247 tests with thresholds; `docker compose --env-file /dev/null config` valid (55 app variables, no mailpit without the profile). The coordinator's decision 61 (main at `0bd717c`) arrived during the assembly; its `.gitignore` was taken into the scratch tree and the docs, `.dockerignore` and a test follow it. Failing-first checks: a stray `CDG`, a banned word and a changed cron in the example each failed the docs tests. Not run: `docker build` and the CI job (the Docker daemon was not running; the Dockerfile was checked by `dockerfile.test.ts` and by reading); the image digests are from 2026-10-14 and Task 12.1 Step 4 re-inspects them.
2. **`ALERT_EMAIL_MAX_PER_HOUR` in spec §12, and WP12 after WP11.** Decision 56 adds the variable and WP11 adds it to the config and `ALL_VARS`, but spec §12's block (and so `.env.example`, which must equal it) does not carry it. Spec revision 26 should add, after `ALERT_EMAIL_FROM=`: `ALERT_EMAIL_MAX_PER_HOUR=20              # outgoing emails an hour, alerts and operator messages; beyond it they are logged and dropped` (comment at column 42 like the others). WP12's compose allowlist, `.env.example` and setup doc need WP11's config, so `depends_on` gains 11 (decision 13 lists 8 and 9; the dispatch table moves WP12 from wave 6 to wave 8 beside WP13's prerequisites, or to a wave 7b after WP11).
3. **Spec §8.2's cadence table and §1's figures are stale against the engine.** For the worked example on 2026-10-14 the engine plans: £0 weekly 28 calls a run (34 with the retry factor), 148 a month (spec "~60", from the withdrawn metro dedup); $40 weekly 28 + 84 + 50 planned, SearchApi 698 a month (spec "~615"); daily 2,330 SearchApi calls a month (spec "~4,300": `budgetFit` counts calendar fetches once per refresh period); `maxCells` 200 plans 1,000 itinerary-search calls a run, 1,200 with the factor, 5,638 a month (spec "~1,090/run"). All fit. The spec should either quote these or point to `docs/scheduling.md`, whose table a test regenerates from the engine.
4. **Fixture recording in the container.** Spec §13 and decision 12 say the recording is invoked from the host with curl against the app. Under decision 61 that cannot work in the image: the recorded tree is never in it (`.dockerignore`), its default root `/app/packages/providers/fixtures/recorded` does not exist and `/app` belongs to root, and a recording made there would be neither committed nor kept. The docs therefore direct recording to a development checkout and use curl for the smoke test only. WP8's `POST /api/tools/record` should refuse inside a container (`IN_CONTAINER`) with a message naming the development path, and spec §13 should drop "and recording" (with decision 61's wording for the recorded tree).
5. **Where WP12's tests live.** The repository files' tests are in `apps/api/test/deploy/` (type-checked, cast-checked and aliased like every api test; the image runs that app) and the root scripts' tests in `scripts/*.test.mjs` (decision 49); there is no separate `infra` Vitest project or tsconfig, and `yaml` is an `apps/api` dev dependency. The plan's file map could name `apps/api/test/deploy/` beside the WP12 files.
6. **The pre-migration boot test** previously in this brief is WP8's Task 8.4 (`app.backup.test.ts`, decisions 32, 53); WP12 keeps the deployment-level checks (CI: backup inside the container, the second app's 75).
7. **The image entry is `apps/api/src/bootstrap/start.ts`** (WP8 brief), while the plan's file map and "Wiring and bootstraps" name `src/bootstrap/app.ts` as the entry; the file map should list `start.ts`.
8. **`pnpm dev` reads no `.env`.** WP8's `dev` script has no `--env-file`, unlike the `tool` script (`--env-file-if-exists=../../.env`), so the setup doc passes `NODE_ENV`, `DATABASE_PATH` and `BIND_ADDRESS` on the command line. If WP8 adds `--env-file-if-exists`, a root `.env` written for compose (no `DATABASE_PATH`) would need a development `DATABASE_PATH` too; the docs would change with it.
