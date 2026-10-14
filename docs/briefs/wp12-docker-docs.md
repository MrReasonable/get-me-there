---
wp: 12
title: Docker, compose, env, backup, docs
owner: sonnet
depends_on: [8]
spec_sections: ["§12", "§13", "§5.5", "§7 Migrations", "§7 Retention", "§7 Budget windows", "§8.2", "§4 auth", "§1", "§9 item 8"]
reviewers: [code-architect, test-strategy-reviewer, devops-reviewer, security-reviewer, cost-and-budget-reviewer, persona-flexible-traveller]
status: draft
---

# WP12: Docker, compose, env, backup, docs

## Goal

Ship the one-container deployment (image, compose file, final `.env.example`), the SQLite backup script with its pre-migration hook and the `/data` writability check, and the three operator documents, each held to the spec by an automated test.

## Scope

**In**

- `Dockerfile` (multi-stage, `node:22-slim` pinned by index digest, pnpm through corepack, fail-closed `better-sqlite3` prebuilt check, `NODE_ENV=production`, `IN_CONTAINER=1`, `/data` owned by `node` before `VOLUME`, `HEALTHCHECK`, `USER node`) and `.dockerignore`.
- `scripts/assert-sqlite-prebuilt.mjs` (build-stage and runtime-stage assertion).
- `docker-compose.yml` (`app` with an explicit environment allowlist built by interpolation, named volume, loopback port, `mailpit` under the `dev` profile).
- `.env.example` made byte-equal to the spec §12 block, with a test that keeps it so.
- `scripts/backup.mjs` (exported `pendingMigrations`, `backupDatabase`, `verifyBackup`, plus a CLI) and the `backups/` line in `.gitignore`.
- `apps/api/src/bootstrap/preflight.ts` (writability check, pending-migration detection, pre-migration backup) and its two call sites in the WP8 bootstraps.
- `docs/setup.md`, `docs/api-limits.md`, `docs/scheduling.md`, `docs/examples/london-new-york.json`.
- The root `infra` Vitest project (`infra/vitest.config.ts`, `infra/tsconfig.json`, `infra/test/**`) and its entry in the root `vitest.config.ts`; `yaml` as a root dev dependency.
- A `docker` job in `.github/workflows/ci.yml` that builds the image, validates the compose file, boots the container to `healthy` and runs a backup inside it.

**Out**

- The app and tool bootstraps themselves, config parsing, `/health`, `/tools/*`, auth and Host checks: WP8 (`apps/api`), on the WP4b wiring helper. WP12 only inserts one `await preflight(...)` line into each bootstrap.
- `applyMigrations`, the Drizzle migrations, the airports dataset and `runMaintenance` (which logs DB size): WP3 (`packages/db`).
- The config zod schema and `PLAN_PRESETS`: WP0 (`packages/core`). WP12 renders them into docs; it changes neither.
- The Definitions form and its "import example" action: WP9 (`apps/web`). WP9 owns `apps/web/src/views/Definitions/exampleDefinition.ts`; WP12 owns the JSON it re-exports and the equality test (Task 12.9).
- The live smoke and recording scripts: WP4b (`record`) and WP13 (`smoke`). WP12 documents how to run them in the container.
- The secret scan and the boundary guard: WP0. WP12 adds no rule to either.

## Spec sections

- **§12**: `.env.example` is the §12 block verbatim; the full preset table (every field per plan) lives in `docs/api-limits.md` and matches the zod presets.
- **§13 entire**: Dockerfile, `.dockerignore`, compose, backup and restore, local dev commands and the three docs, each rule listed in §13.
- **§5.5**: the Dockerfile sets `NODE_ENV=production` and `IN_CONTAINER=1`; compose passes an explicit `environment` allowlist that never carries `ALLOW_FIXTURE_PROVIDER` or `NODE_ENV`.
- **§7 Migrations**: a `VACUUM INTO` backup runs first only when migrations are pending, to a timestamped file under `/data/backups`, keeps the last 5, refuses an existing target; a failed backup refuses migrations and boot, naming the cause.
- **§7 Retention**: expected DB growth per month is documented in `docs/setup.md`.
- **§7 Budget windows**: billing days 1–28 (UTC), `trial` lifetime window; `docs/api-limits.md` explains window bounds and reconciliation with the vendor dashboard.
- **§8.2**: `docs/scheduling.md` carries the cadence table, cron examples, pausing, missed firings and `skipped_missed`.
- **§4 auth notes**: `docs/setup.md` makes the two auth variables the first step, sets `ALLOWED_HOSTS` for every hostname users type with Tailscale and reverse-proxy examples, and states that basic auth beyond loopback needs a TLS reverse proxy or Tailscale.
- **§1**: `docs/setup.md` carries the London → New York example as importable JSON; the £0 path is a three-line `.env`.
- **§9 item 8**: a Dockerfile assertion for `NODE_ENV=production` and `IN_CONTAINER=1`.

## Interfaces consumed

Copied from the plan's "Cross-package contracts".

```ts
// @gmt/core config/presets.ts (WP0)
export type PlanId = 'trial' | '40usd';
export interface ProviderLimits { monthlyCallCap: number; window: 'month' | 'lifetime'; billingDay: number; ratePerMinute: number; ratePerHour: number; concurrency: number; cacheTtlHours: number; costPerCallMicroGbp: number; planFixedMicroGbp: number; excludedFromSchedule: boolean }
export const PLAN_PRESETS: Record<PlanId, ProviderLimits & { monthlySpendCapMicroGbp: number; executionMaxCalls: number; executionMaxCostMicroGbp: number }>;
export const TRAVELPAYOUTS_DEFAULTS: ProviderLimits;   // cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0, fixed 0

// @gmt/core config/schema.ts (WP0): only `databasePath` is read by WP12 code
export interface Config { nodeEnv: 'production' | 'development' | 'test'; databasePath: string; /* … */ }

// @gmt/core ports/logger.ts (WP0)
export interface Logger { debug(o: object, msg?: string): void; info(o: object, msg?: string): void; warn(o: object, msg?: string): void; error(o: object, msg?: string): void; child(bindings: object): Logger }

// @gmt/core text/bannedWords.ts (WP0)
export const BANNED_WORDS: readonly string[] = ['exhaustive', 'all combinations', 'every combination', 'live', 'bookable', 'guaranteed', 'real-time'];
export function findBannedWords(text: string, allowlist?: readonly string[]): Array<{ word: string; index: number }>;

// @gmt/core api-contract/definitions.ts (WP0)
// definitionCreateRequestSchema (every SearchDefinition field except id/timestamps; `window` discriminated union;
// `bookingLinks` forced true when `providers.verification` includes `searchapi` via `superRefine`)

// @gmt/db client.ts (WP0)
export interface Db { raw: BetterSqlite3.Database; drizzle: BetterSQLite3Database; transaction<T>(fn: () => T): T; close(): void }
export function openDatabase(path: string): Db;

// apps/api wiring.ts (WP4b)
export function buildPorts(config: Config, opts: { log: Logger; clock?: Clock; recorder?: FixtureRecorder; migrationsDir: string }): Ports;   // opens DB, applies migrations, …
export function loadConfigFromEnv(env: NodeJS.ProcessEnv): Config;
// bootstrap/app.ts (WP8): main() — refuses NODE_ENV=test; buildPorts; seed; AppLock('app'); engine.boot(); serve
// bootstrap/tool.ts (WP4b): runTool(name: 'record' | 'smoke', args) — refuses NODE_ENV=test; buildPorts; AppLock('tool'); no engine.boot()
```

Two facts WP12 relies on beyond these signatures, both already true of WP8's code by its own tests: running `node apps/api/dist/bootstrap/app.js` (or `tsx src/bootstrap/app.ts`) executes `main()`, and an exception thrown inside `main()` is printed with its message and exits non-zero. Task 12.5's spawn test proves both for the preflight path.

Drizzle's migrator (`drizzle-orm@0.45.4`, `sqlite-core/dialect.js`) applies a journal entry when `__drizzle_migrations` has no row or its newest `created_at` is less than the entry's `when`. `pendingMigrations` in Task 12.4 reproduces exactly that rule without writing.

## Interfaces produced

```js
// scripts/backup.mjs (WP12). Plain ESM so `docker compose exec app node scripts/backup.mjs` needs no build.
/** better-sqlite3's Database constructor, resolved from packages/db so the script works in the repo and the image. */
export const Database;
/** Journal tags Drizzle would apply to the database at dbPath; [] when the file does not exist. Spec §7 "Migrations". */
export function pendingMigrations(dbPath: string, migrationsDir: string): string[];
/** Throws unless PRAGMA integrity_check on path returns 'ok'. */
export function verifyBackup(path: string): void;
/** VACUUM INTO <backupDir>/<base>-<ISO timestamp>.db, verify, prune to `keep` (default 5). Throws on any failure and leaves no partial target. */
export function backupDatabase(opts: { dbPath: string; backupDir: string; keep?: number; now?: Date }): { path: string; pruned: string[] };
// CLI: node scripts/backup.mjs [--db <path>] [--dir <path>] [--keep <n>]; exit 0 prints one JSON line, exit 1 prints the cause.
```

```ts
// apps/api/src/bootstrap/preflight.ts (WP12)
export interface BackupModule {
  pendingMigrations(dbPath: string, migrationsDir: string): string[];
  backupDatabase(opts: { dbPath: string; backupDir: string; keep?: number; now?: Date }): { path: string; pruned: string[] };
}
export interface PreflightResult { pending: string[]; backupPath: string | null }
export class PreflightError extends Error {}
export function assertDataDirWritable(databasePath: string): void;
export function loadBackupModule(repoRoot?: string): Promise<BackupModule>;
export function preflight(config: Pick<Config, 'databasePath'>, opts: { migrationsDir: string; log: Logger; backup?: BackupModule }): Promise<PreflightResult>;
```

`docs/examples/london-new-york.json`: the importable example definition, a `definitionCreateRequestSchema`-valid object. **Contract for WP9:** `apps/web/src/views/Definitions/exampleDefinition.ts` exports `EXAMPLE_DEFINITION` as a re-export of that file (`import example from '../../../../../docs/examples/london-new-york.json' with { type: 'json' }`), so no airport code is written in application source (spec §1). Task 12.9 asserts both halves.

## Library notes

All verified on 2026-10-14.

- **Base image `node:22-slim`**: `docker buildx imagetools inspect node:22-slim` returned the multi-platform index digest `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` (image created 2026-10-06, `NODE_VERSION=22.23.3`, Debian bookworm-slim, `linux/amd64` manifest `sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562`). Pin the **index** digest (the top-level `Digest:` line) so arm64 hosts get the same release. To refresh: run the same command, copy the top-level `Digest:` into every `FROM`, update the comment block at the top of the Dockerfile and this paragraph.
- **better-sqlite3 13.0.3** (`packages/db`, from the plan's Task 0.1 list). npm registry integrity `sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==`; the same string must appear in `pnpm-lock.yaml` (Task 12.1 asserts it). The tarball (inspected with `npm pack better-sqlite3@13.0.3`) ships `prebuilds/{linux,linuxmusl,darwin,win32}-{x64,arm64}.node`, has **no `install` script** and `"gypfile": false`; `lib/binding.js` loads `prebuilds/<platform>-<arch>.node` and falls back to `build/Release/better_sqlite3.node` only when no prebuilt exists. So there is no network fetch to make fail-closed: the binary arrives inside the integrity-pinned tarball, and fail-closed means asserting the prebuilt file exists, `build/` does not, and the module loads (`scripts/assert-sqlite-prebuilt.mjs`). `npm_config_build_from_source` is read by `prebuild-install`, which 13.x no longer uses, so it is not set. `onlyBuiltDependencies: [better-sqlite3]` in `pnpm-workspace.yaml` stays as WP0 wrote it; it is now inert for this package and still blocks every other dependency's build scripts. Calls used: `new Database(path, { readonly: true, fileMustExist: true, timeout: 5000 })`, `db.prepare('VACUUM INTO ?').run(target)`, `db.pragma('integrity_check', { simple: true })` (returns `'ok'`), `db.prepare(sql).pluck().all()`. Checked by running them against 13.0.3 on 2026-10-14: `VACUUM INTO` with a bound path works on a WAL source; an existing target throws `SQLITE_ERROR: output file already exists`; a non-SQLite file throws `SQLITE_NOTADB: file is not a database` on open and leaves no target behind; the backup copy has `journal_mode=delete`, which the app's `openDatabase` switches back to WAL on first open.
- **drizzle-orm 0.45.4** migrator: read in the published package (`sqlite-core/dialect.js`, `migrator.js`) and context7 `/drizzle-team/drizzle-orm` ("readMigrationFiles"): reads `<migrationsFolder>/meta/_journal.json` `entries[{ idx, when, tag, breakpoints }]`; table `__drizzle_migrations (id, hash, created_at numeric)`; selects the newest `created_at` and applies entries with `when > created_at`.
- **yaml 2.9.1** (new root dev dependency, published 2026-09-11): context7 `/eemeli/yaml`, "YAML.parse": `import { parse } from 'yaml'`; `parse(str)` returns plain objects and arrays, throws on error, single document only.
- **pnpm 12.9.1 via corepack**: `npm view pnpm@12.9.1` exists (engines `node >=18`). Node 22 still bundles corepack (it is removed from Node 25 onward, which is why the image is 22). `corepack enable pnpm` installs the shim; the version comes from `"packageManager": "pnpm@12.9.1"` in the root `package.json`; `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` suppresses the interactive prompt. Task 12.1 Step 4 runs `docker run --rm node:22-slim@sha256:c3de… corepack --version` before the first build to confirm corepack is present in that exact image; the Dockerfile itself fails the build if the resolved pnpm version differs from `packageManager`.
- **Dockerfile syntax**: context7 `/docker/docs` (Dockerfile reference, "HEALTHCHECK"): options `--interval` (default 30s), `--timeout` (30s), `--start-period` (0s), `--start-interval` (5s, Engine ≥ 25), `--retries` (3); exec form `CMD ["node", "-e", "…"]`; only the last `HEALTHCHECK` counts; probe failures during the start period do not count toward retries. Multi-stage `FROM … AS name` and `COPY --from=name`; `RUN --mount=type=cache,id=…,target=…` (BuildKit, the default builder).
- **Compose**: context7 `/docker/docs` ("variable interpolation"): `${VAR:-default}` resolves from the shell, then `--env-file`, then the project `.env`; `docker compose config` shows the result. Interpolation is the allowlist mechanism here: only the names written in `environment:` reach the container, unlike `env_file:`, which forwards every line of `.env`.
- **Mailpit** (`dev` profile only): `docker buildx imagetools inspect axllent/mailpit:latest` returned `sha256:94f6b70c1436defae6799d9ac7ff0eeff9540465b842026d5cdb018f1c0234ea` (created 2026-10-11); SMTP on 1025, web UI on 8025.
- **Vitest 5.0.4**: `test.projects` in the root config (plan Task 0.1); an `infra` project with no `coverage` block has no threshold.

## Files

- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/assert-sqlite-prebuilt.mjs`, `scripts/backup.mjs`, `apps/api/src/bootstrap/preflight.ts`, `docs/setup.md`, `docs/api-limits.md`, `docs/scheduling.md`, `docs/examples/london-new-york.json`, `infra/vitest.config.ts`, `infra/tsconfig.json`
- Modify: `.env.example` (byte-equal to spec §12), `.gitignore` (add `backups/`), `vitest.config.ts` (root: add the infra project), `package.json` (root: `yaml` dev dependency, `typecheck` script), `pnpm-lock.yaml` (from `pnpm add`), `apps/api/src/bootstrap/app.ts` and `apps/api/src/bootstrap/tool.ts` (one `await preflight(...)` each), `.github/workflows/ci.yml` (add the `docker` job)
- Test: `infra/test/helpers.ts`, `infra/test/dockerfile.test.ts`, `infra/test/envExample.test.ts`, `infra/test/compose.test.ts`, `infra/test/backup.test.ts`, `infra/test/presetTable.ts`, `infra/test/apiLimits.test.ts`, `infra/test/docs.test.ts`, `infra/test/exampleDefinition.test.ts`, `apps/api/test/bootstrap/preflight.test.ts`, `apps/api/test/bootstrap/preMigrationBoot.test.ts`

## Tasks

### Task 12.1: Infra test project, Dockerfile and `.dockerignore` (first failing test)

**Files:**
- Create: `infra/vitest.config.ts`, `infra/tsconfig.json`, `infra/test/helpers.ts`, `infra/test/dockerfile.test.ts`, `Dockerfile`, `.dockerignore`, `scripts/assert-sqlite-prebuilt.mjs`
- Modify: `vitest.config.ts` (root), `package.json` (root `typecheck` script)

**Interfaces:**
- Consumes: `pnpm-lock.yaml` (WP0), `apps/api/src/bootstrap/app.ts` (WP8), the build outputs `packages/*/dist`, `apps/web/dist`, `packages/db/drizzle`, `packages/db/data` (WP0, WP3, WP8, WP9).
- Produces: the image; `scripts/assert-sqlite-prebuilt.mjs`; the `infra` Vitest project and `infra/test/helpers.ts`.

- [ ] **Step 1: Scaffold the infra project**

`infra/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// why: repository-level files (Dockerfile, compose, scripts/, docs/) belong to no package, so
// their tests live in a root project. No coverage block: the infra project has no threshold
// (brief WP12 "Coverage"); the packages keep theirs.
export default defineConfig({
  test: {
    name: 'infra',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

Root `vitest.config.ts` (replaces the WP0 file):

```ts
import { defineConfig } from 'vitest/config';

// why: one root config so `pnpm test` runs every package with its own thresholds, plus the
// infra project that checks the Dockerfile, compose file, backup script and docs (WP12).
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts', 'infra/vitest.config.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

`infra/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "allowJs": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["test/**/*.ts"]
}
```

Root `package.json`, `scripts.typecheck` becomes:

```json
"typecheck": "pnpm -r typecheck && tsc -p infra/tsconfig.json"
```

`// why:` `pnpm -r` skips the workspace root, so the infra tests would otherwise never be type-checked.

`infra/test/helpers.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file so tests run from any cwd. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Reads a repository file as UTF-8. */
export function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

export const SPEC_PATH = 'docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md';

export interface DockerStage {
  from: string;
  instructions: string[];
}

/**
 * Splits a Dockerfile into stages of logical instructions: backslash continuations joined,
 * comments and blank lines dropped, whitespace collapsed. Enough for assertions on our own
 * Dockerfile; not a general parser.
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

/** Text strictly between the first `start` marker and the next `end` marker; throws if either is missing. */
export function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`marker not found: ${start}`);
  const j = text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`marker not found: ${end}`);
  return text.slice(i + start.length, j);
}
```

- [ ] **Step 2: Write the failing test**

`infra/test/dockerfile.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, dockerfileStages, read } from './helpers.js';

const stages = dockerfileStages(read('Dockerfile'));
const runtime = stages.at(-1);
const runtimeInstructions = runtime?.instructions ?? [];
const indexOf = (predicate: (s: string) => boolean) => runtimeInstructions.findIndex(predicate);

describe('Dockerfile (spec §13, §5.5, §9 item 8)', () => {
  it('sets production and the container flag in the runtime stage', () => {
    expect(runtimeInstructions).toContain('ENV NODE_ENV=production');
    expect(runtimeInstructions).toContain('ENV IN_CONTAINER=1');
  });

  it('never sets NODE_ENV or ALLOW_FIXTURE_PROVIDER anywhere else', () => {
    const all = stages.flatMap((s) => s.instructions);
    expect(all.filter((i) => /\bNODE_ENV=/.test(i))).toEqual(['ENV NODE_ENV=production']);
    expect(all.some((i) => i.includes('ALLOW_FIXTURE_PROVIDER'))).toBe(false);
  });

  it('pins every stage to the same node:22-slim index digest', () => {
    expect(stages.length).toBeGreaterThanOrEqual(2);
    const digests = stages.map((s) => /^FROM node:22-slim@sha256:([0-9a-f]{64})(?: AS [a-z-]+)?$/.exec(s.from)?.[1]);
    expect(digests.every((d) => d !== undefined)).toBe(true);
    expect(new Set(digests).size).toBe(1);
  });

  it('runs as node from the last RUN onwards', () => {
    const lastRun = runtimeInstructions.map((i) => i.startsWith('RUN ')).lastIndexOf(true);
    const userLines = runtimeInstructions.filter((i) => i.startsWith('USER '));
    expect(userLines).toEqual(['USER node']);
    expect(indexOf((i) => i === 'USER node')).toBeGreaterThan(lastRun);
  });

  it('creates /data owned by node before declaring the volume', () => {
    const prepare = indexOf((i) => i.startsWith('RUN ') && i.includes('mkdir -p /data/backups') && i.includes('chown -R node:node /data'));
    const volume = indexOf((i) => i === 'VOLUME ["/data"]');
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(volume).toBeGreaterThan(prepare);
  });

  it('has a node fetch HEALTHCHECK of /health whose start period covers boot (≥ 180 s)', () => {
    const hc = runtimeInstructions.find((i) => i.startsWith('HEALTHCHECK '));
    expect(hc).toBeDefined();
    const start = Number(/--start-period=(\d+)s/.exec(hc ?? '')?.[1]);
    expect(start).toBeGreaterThanOrEqual(180);
    expect(hc).toContain('CMD ["node", "-e",');
    expect(hc).toContain("fetch('http://127.0.0.1:3000/health')");
  });

  it('starts the app bootstrap', () => {
    expect(runtimeInstructions.at(-1)).toBe('CMD ["node", "apps/api/dist/bootstrap/app.js"]');
    expect(existsSync(join(ROOT, 'apps/api/src/bootstrap/app.ts'))).toBe(true);
  });

  it('copies migrations, the airports dataset, scripts and the web build into the runtime image', () => {
    for (const path of ['/app/packages/db/drizzle', '/app/packages/db/data', '/app/scripts', '/app/apps/web/dist']) {
      expect(runtimeInstructions.some((i) => i.startsWith('COPY --from=build ') && i.includes(` ${path} `))).toBe(true);
    }
    expect(runtimeInstructions.some((i) => i.startsWith('COPY --from=prod-deps /app/node_modules '))).toBe(true);
  });

  it('installs with the frozen lockfile, pnpm from packageManager, and asserts the sqlite prebuilt', () => {
    const all = stages.flatMap((s) => s.instructions).join('\n');
    expect(all).toMatch(/pnpm install --frozen-lockfile/);
    expect(all).toMatch(/pnpm install --frozen-lockfile --prod --filter "@gmt\/api\.\.\."/);
    expect(all).toContain('corepack enable pnpm');
    expect(all).toContain('packageManager');
    expect(stages.filter((s) => s.instructions.some((i) => i === 'RUN node scripts/assert-sqlite-prebuilt.mjs' || i.startsWith('RUN node scripts/assert-sqlite-prebuilt.mjs ')))).toHaveLength(3);
  });
});

describe('.dockerignore (spec §13)', () => {
  const lines = read('.dockerignore').split('\n').map((l) => l.trim());
  it.each(['.env*', 'data/', 'fixtures/recorded/', '**/fixtures/recorded/', 'node_modules/', '**/node_modules/', '*.db*', 'backups/'])('excludes %s', (entry) => {
    expect(lines).toContain(entry);
  });
  it('keeps docs/ in the build context (the web build imports docs/examples)', () => {
    expect(lines.some((l) => l === 'docs/' || l === 'docs' || l === 'docs/**')).toBe(false);
  });
});

describe('better-sqlite3 prebuilt is fail-closed (spec §4, §13)', () => {
  it('pnpm-lock.yaml pins 13.0.3 to the integrity recorded in the WP12 brief', () => {
    const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8').split('\n');
    const at = lock.findIndex((l) => l.trim() === 'better-sqlite3@13.0.3:');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lock.slice(at, at + 4).join('\n')).toContain('sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==');
  });
  it('the assertion script passes on this machine', () => {
    const r = spawnSync(process.execPath, ['scripts/assert-sqlite-prebuilt.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^better-sqlite3 13\.0\.3 prebuilt ok: .*prebuilds[/\\][a-z0-9]+-[a-z0-9]+\.node/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run --project infra`
Expected: FAIL, `ENOENT: no such file or directory, open '…/Dockerfile'` while collecting `dockerfile.test.ts`.

- [ ] **Step 4: Confirm the base image ships corepack**

Run: `docker run --rm node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 corepack --version`
Expected: a version number (0.3x.y) and exit 0. If it prints `corepack: not found`, stop and report to Fable: the brief's corepack assumption is wrong for this image.

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
if (version !== EXPECTED_VERSION) failures.push(`better-sqlite3 ${version} resolved, expected ${EXPECTED_VERSION}`);
if (!existsSync(prebuilt)) failures.push(`no prebuilt binary at ${prebuilt}`);
if (existsSync(join(root, 'build'))) failures.push(`a source build exists at ${join(root, 'build')}; refusing it`);

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
# why node 22: it still bundles corepack, the image is the supported runtime in spec §4.

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
# why: the image keeps the workspace layout (root node_modules/.pnpm plus per-package symlinks),
# so workspace imports, the db migrations path and scripts/backup.mjs resolve exactly as in the repo.
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
# why: a fresh named volume copies the ownership of the image directory it is mounted on, so
# /data must exist and belong to node before VOLUME, or the first boot cannot write the DB.
RUN node scripts/assert-sqlite-prebuilt.mjs \
 && mkdir -p /data/backups \
 && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
# why: start period 240 s covers migrations, the pre-migration backup, airport seeding and the
# app_lock waits (60 s for a tool lock, 90 s for a stale app lock; spec §7) with margin.
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/bootstrap/app.js"]
```

`.dockerignore`:

```
# Secrets and local state never enter the build context (spec §13).
.env*
data/
backups/
*.db*
# Recorded vendor fixtures: the spec path and the plan's actual location under packages/providers.
fixtures/recorded/
**/fixtures/recorded/
# Rebuilt inside the image.
node_modules/
**/node_modules/
**/dist/
**/coverage/
# Repository metadata.
.git/
.github/
.claude/
.memsearch/
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run --project infra && docker build -t get-me-there:local .`
Expected: infra tests PASS (dockerfile.test.ts, 20 tests); the build log shows `better-sqlite3 13.0.3 prebuilt ok: /app/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/prebuilds/linux-x64.node` three times (on arm64 hosts `linux-arm64.node`) and ends with `naming to docker.io/library/get-me-there:local`.

Then: `docker run --rm --entrypoint id get-me-there:local -u`
Expected: `1000`.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore scripts/assert-sqlite-prebuilt.mjs infra vitest.config.ts package.json
git commit -m "wp12: Dockerfile with production flags, digest pin and fail-closed sqlite prebuilt"
```

### Task 12.2: `.env.example` equal to spec §12

**Files:**
- Modify: `.env.example`
- Test: `infra/test/envExample.test.ts`; add `envExampleVariables` to `infra/test/helpers.ts`

**Interfaces:**
- Produces: `envExampleVariables(text): string[]` (test helper used by Task 12.3).

- [ ] **Step 1: Write the failing test**

Append to `infra/test/helpers.ts`:

```ts
/**
 * Every variable name the spec §12 block defines: `NAME=` lines plus the names in each
 * `# overrides: FULL_NAME, _SUFFIX, …` comment (a suffix takes the first name's prefix).
 * Commented assignments (`# IN_CONTAINER=1`) are not operator variables and are skipped.
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

`infra/test/envExample.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { envExampleVariables, read, specEnvBlock } from './helpers.js';

describe('.env.example (spec §12)', () => {
  it('is the spec §12 block verbatim', () => {
    expect(read('.env.example')).toBe(`${specEnvBlock()}\n`);
  });

  it('defines the 55 variables of spec §12, overrides expanded', () => {
    const names = envExampleVariables(read('.env.example'));
    expect(names).toHaveLength(55);
    expect(names).toEqual(expect.arrayContaining(['NODE_ENV', 'ALLOW_FIXTURE_PROVIDER', 'TRAVELPAYOUTS_CACHE_TTL_HOURS', 'SEARCHAPI_PLAN_FIXED_PENCE', 'SEARCHAPI_COST_PER_CALL_MICRO_GBP', 'ALERT_EMAIL_FROM']));
    expect(names).not.toContain('IN_CONTAINER');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project infra envExample`
Expected: FAIL on "is the spec §12 block verbatim" with a diff (WP0 wrote the file by hand; any whitespace or comment drift shows here). If WP0's copy is already exact the first test passes and the second fails only if the count differs; in that case record "already equal" in the commit message and continue.

- [ ] **Step 3: Implement**

Run: `node -e "const fs=require('node:fs');const s=fs.readFileSync('docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md','utf8').split('## 12. Configuration')[1];const a=s.indexOf('\`\`\`\n')+4;const b=s.indexOf('\n\`\`\`',a);fs.writeFileSync('.env.example',s.slice(a,b)+'\n')"`

`// why:` generating the file from the spec removes any chance of a hand-copy typo; the test keeps it equal from now on.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --project infra envExample`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .env.example infra/test && git commit -m "wp12: .env.example equals spec §12"
```

### Task 12.3: `docker-compose.yml` with an interpolated environment allowlist

**Files:**
- Create: `docker-compose.yml`
- Modify: `package.json` (root dev dependency `yaml@2.9.1`), `pnpm-lock.yaml`
- Test: `infra/test/compose.test.ts`

**Interfaces:**
- Consumes: `envExampleVariables` (Task 12.2).
- Produces: services `app` and `mailpit`, volume `gmt-data` (Docker names it `get-me-there_gmt-data`).

- [ ] **Step 1: Add the dependency**

Run: `pnpm add -Dw yaml@2.9.1`
Expected: `devDependencies: + yaml 2.9.1`.

- [ ] **Step 2: Write the failing test**

`infra/test/compose.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { envExampleVariables, read } from './helpers.js';

interface Service {
  build?: unknown; image?: string; init?: boolean; restart?: string; stop_grace_period?: string; ports?: string[];
  volumes?: string[]; environment?: Record<string, string>; env_file?: unknown; healthcheck?: unknown;
  logging?: { driver?: string; options?: Record<string, string> }; profiles?: string[];
}
interface Compose { name?: string; services: Record<string, Service>; volumes?: Record<string, unknown> }

const compose = parse(read('docker-compose.yml')) as Compose;
const app = compose.services.app as Service;
const env = app.environment ?? {};

/** Variables the container must never receive from compose (spec §5.5, §12). */
const NEVER = ['NODE_ENV', 'ALLOW_FIXTURE_PROVIDER', 'IN_CONTAINER'];
/** Values compose fixes because the image layout or the published port depends on them. */
const FIXED: Record<string, string> = { DATABASE_PATH: '/data/get-me-there.db', PORT: '3000', BIND_ADDRESS: '0.0.0.0' };

describe('docker-compose.yml app service (spec §13, §5.5)', () => {
  it('passes an explicit allowlist: every spec §12 operator variable and nothing else', () => {
    const expected = envExampleVariables(read('.env.example')).filter((n) => !NEVER.includes(n));
    expect(expected).toHaveLength(53);
    expect(Object.keys(env).sort()).toEqual(expected);
  });

  it('never passes NODE_ENV, ALLOW_FIXTURE_PROVIDER or IN_CONTAINER, and has no env_file', () => {
    for (const name of NEVER) expect(env).not.toHaveProperty(name);
    expect(app.env_file).toBeUndefined();
  });

  it('interpolates every non-fixed variable with an empty default and nothing else', () => {
    for (const [name, value] of Object.entries(env)) {
      if (name in FIXED) expect(value).toBe(FIXED[name]);
      else expect(value).toBe(`\${${name}:-}`);
    }
  });

  it('publishes on loopback only', () => {
    expect(app.ports).toEqual(['127.0.0.1:3000:3000']);
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

describe('docker-compose.yml mailpit service (spec §13)', () => {
  const mailpit = compose.services.mailpit as Service;
  it('exists only under the dev profile, pinned by digest, on loopback ports', () => {
    expect(mailpit.profiles).toEqual(['dev']);
    expect(mailpit.image).toMatch(/^axllent\/mailpit@sha256:[0-9a-f]{64}$/);
    expect(mailpit.ports).toEqual(['127.0.0.1:1025:1025', '127.0.0.1:8025:8025']);
  });
  it('the app service has no profile, so `docker compose up` never starts mailpit', () => {
    expect(app.profiles).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run --project infra compose`
Expected: FAIL, `ENOENT … docker-compose.yml`.

- [ ] **Step 4: Implement**

`docker-compose.yml`:

```yaml
# get-me-there: one app container, one SQLite file on a named volume. Spec §13.
#
# Configuration: write your values in .env next to this file (see docs/setup.md). Compose reads
# .env for ${...} interpolation only; the container receives exactly the names listed under
# `environment:` below. That list is the allowlist of spec §5.5: NODE_ENV and IN_CONTAINER come
# from the Dockerfile, and ALLOW_FIXTURE_PROVIDER is never passed. Do not add `env_file:`, which
# would forward every line of .env and defeat the allowlist.
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
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  # Local mail catcher for development only: `docker compose --profile dev up -d mailpit`.
  # why: it serves `pnpm dev` on the host (SMTP_HOST=127.0.0.1, SMTP_PORT=1025, SMTP_TLS=none,
  # which the config schema allows on loopback). The app container runs NODE_ENV=production, where
  # SMTP_TLS=none is refused for any non-loopback host, so the container never mails through it.
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

Run: `pnpm vitest run --project infra compose && docker compose config --quiet`
Expected: PASS (9 tests); `docker compose config --quiet` prints nothing and exits 0 (with or without a `.env`).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml package.json pnpm-lock.yaml infra/test && git commit -m "wp12: compose with interpolated environment allowlist and dev mailpit"
```

### Task 12.4: `scripts/backup.mjs`

**Files:**
- Create: `scripts/backup.mjs`
- Modify: `.gitignore` (add `backups/`)
- Test: `infra/test/backup.test.ts`

**Interfaces:**
- Produces: `Database`, `pendingMigrations`, `verifyBackup`, `backupDatabase`, the CLI.

- [ ] **Step 1: Write the failing test**

`infra/test/backup.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database, backupDatabase, pendingMigrations, verifyBackup } from '../../scripts/backup.mjs';
import { ROOT, read } from './helpers.js';

const NAME = /^get-me-there-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gmt-backup-'));
}

/** A small WAL database with one table and a row, standing in for /data/get-me-there.db. */
function sampleDb(dir: string): string {
  const path = join(dir, 'get-me-there.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (x INTEGER NOT NULL)');
  db.prepare('INSERT INTO t (x) VALUES (?)').run(42);
  db.close();
  return path;
}

/** A Drizzle-shaped migrations folder with two journal entries. */
function migrationsDir(dir: string): string {
  const out = join(dir, 'drizzle');
  mkdirSync(join(out, 'meta'), { recursive: true });
  writeFileSync(join(out, 'meta', '_journal.json'), JSON.stringify({
    version: '7', dialect: 'sqlite',
    entries: [
      { idx: 0, version: '6', when: 1_760_400_000_000, tag: '0000_init', breakpoints: true },
      { idx: 1, version: '6', when: 1_760_500_000_000, tag: '0001_next', breakpoints: true },
    ],
  }));
  return out;
}

function markApplied(dbPath: string, createdAt: number | null): void {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  if (createdAt !== null) db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run('h', createdAt);
  db.close();
}

describe('backupDatabase (spec §7 Migrations, §13 Backup)', () => {
  it('writes a timestamped VACUUM INTO copy under the backup dir that passes integrity_check', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    const r = backupDatabase({ dbPath: db, backupDir: join(dir, 'backups'), now: new Date('2026-10-14T15:00:00.000Z') });
    expect(r.path).toBe(join(dir, 'backups', 'get-me-there-2026-10-14T15-00-00-000Z.db'));
    expect(r.pruned).toEqual([]);
    const copy = new Database(r.path, { readonly: true });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.prepare('SELECT x FROM t').pluck().get()).toBe(42);
    copy.close();
  });

  it('refuses an existing target', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    const now = new Date('2026-10-14T15:00:00.000Z');
    backupDatabase({ dbPath: db, backupDir: join(dir, 'backups'), now });
    expect(() => backupDatabase({ dbPath: db, backupDir: join(dir, 'backups'), now })).toThrow(/backup target already exists/);
  });

  it('keeps the newest 5 and leaves unrelated files alone', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'notes.txt'), 'operator notes');
    const results = [1, 2, 3, 4, 5, 6, 7].map((day) =>
      backupDatabase({ dbPath: db, backupDir: backups, now: new Date(`2026-10-0${day}T03:15:00.000Z`) }),
    );
    const kept = readdirSync(backups).filter((f) => NAME.test(f)).sort();
    expect(kept).toEqual(['03', '04', '05', '06', '07'].map((d) => `get-me-there-2026-10-${d}T03-15-00-000Z.db`));
    expect(results.at(-1)?.pruned).toEqual([join(backups, 'get-me-there-2026-10-02T03-15-00-000Z.db')]);
    expect(existsSync(join(backups, 'notes.txt'))).toBe(true);
  });

  it('fails on a corrupted source and leaves no partial target', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    writeFileSync(db, 'this is not a database file '.repeat(200));
    expect(() => backupDatabase({ dbPath: db, backupDir: join(dir, 'backups') })).toThrow(/backup failed: .*not a database/);
    expect(readdirSync(join(dir, 'backups'))).toEqual([]);
  });

  it('fails when the backup directory cannot be created', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    writeFileSync(join(dir, 'backups'), 'a file where the directory should be');
    expect(() => backupDatabase({ dbPath: db, backupDir: join(dir, 'backups') })).toThrow(/backup failed/);
  });
});

describe('verifyBackup', () => {
  it('passes a sound file and rejects a corrupted one', () => {
    const dir = tempDir();
    expect(() => verifyBackup(sampleDb(dir))).not.toThrow();
    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'garbage '.repeat(500));
    expect(() => verifyBackup(bad)).toThrow(/not a database/);
  });
});

describe('pendingMigrations (Drizzle rule: apply entries whose `when` > newest created_at)', () => {
  it('is empty when the database file does not exist', () => {
    const dir = tempDir();
    expect(pendingMigrations(join(dir, 'absent.db'), migrationsDir(dir))).toEqual([]);
  });
  it('lists every entry when the migrations table is missing or empty', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    const m = migrationsDir(dir);
    expect(pendingMigrations(db, m)).toEqual(['0000_init', '0001_next']);
    markApplied(db, null);
    expect(pendingMigrations(db, m)).toEqual(['0000_init', '0001_next']);
  });
  it('lists only entries newer than the last applied one', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    const m = migrationsDir(dir);
    markApplied(db, 1_760_400_000_000);
    expect(pendingMigrations(db, m)).toEqual(['0001_next']);
    markApplied(db, 1_760_500_000_000);
    expect(pendingMigrations(db, m)).toEqual([]);
  });
});

describe('backup CLI', () => {
  it('exits 0 and prints the backup path', () => {
    const dir = tempDir();
    const db = sampleDb(dir);
    const r = spawnSync(process.execPath, ['scripts/backup.mjs', '--db', db, '--dir', join(dir, 'b'), '--keep', '2'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; path: string; pruned: string[] };
    expect(out.ok).toBe(true);
    expect(existsSync(out.path)).toBe(true);
  });
  it('exits 1 with the cause on a corrupted database', () => {
    const dir = tempDir();
    const db = join(dir, 'get-me-there.db');
    writeFileSync(db, 'nope '.repeat(500));
    const r = spawnSync(process.execPath, ['scripts/backup.mjs', '--db', db], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/backup failed: .*not a database/);
  });
  it('rejects an unknown flag', () => {
    const r = spawnSync(process.execPath, ['scripts/backup.mjs', '--force'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown argument --force/);
  });
});

describe('.gitignore (spec §5.3, §13)', () => {
  it('ignores backups/', () => {
    expect(read('.gitignore').split('\n')).toContain('backups/');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project infra backup`
Expected: FAIL, `Failed to load url ../../scripts/backup.mjs`.

- [ ] **Step 3: Implement**

`scripts/backup.mjs`:

```js
#!/usr/bin/env node
// SQLite backup for get-me-there. Spec §7 "Migrations" and §13 "Backup".
//
// - VACUUM INTO a timestamped file under the backup directory (default <db dir>/backups),
//   PRAGMA integrity_check on the output, refuse an existing target, keep the newest N (5).
// - Exported for the api bootstrap's pre-migration hook (apps/api/src/bootstrap/preflight.ts)
//   and runnable on demand: `docker compose exec app node scripts/backup.mjs`.
// - Plain ESM with JSDoc types so it runs in the image without a build step.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// why: resolve better-sqlite3 from packages/db (its only workspace dependant) so the same
// resolution works in the repository and in the image, which keeps the workspace layout.
const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));

/** better-sqlite3's Database constructor. @type {typeof import('better-sqlite3')} */
export const Database = requireFromDb('better-sqlite3');

const DEFAULT_KEEP = 5;

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Journal tags that Drizzle's migrator would apply to the database at `dbPath`, using its own
 * rule: an entry is applied when `__drizzle_migrations` is empty or its newest `created_at` is
 * less than the entry's `when`. A missing file has nothing to protect, so it returns [].
 * Opens the database read-only and writes nothing.
 * @param {string} dbPath
 * @param {string} migrationsDir
 * @returns {string[]}
 */
export function pendingMigrations(dbPath, migrationsDir) {
  if (!existsSync(dbPath)) return [];
  /** @type {{ entries: Array<{ when: number; tag: string }> }} */
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").pluck().get();
    /** @type {unknown} */
    const last = hasTable ? db.prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1').pluck().get() : undefined;
    const lastMillis = last === undefined || last === null ? null : Number(last);
    return journal.entries.filter((e) => lastMillis === null || lastMillis < e.when).map((e) => e.tag);
  } finally {
    db.close();
  }
}

/**
 * Throws unless `PRAGMA integrity_check` on the file at `path` returns 'ok'.
 * @param {string} path
 */
export function verifyBackup(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check on ${path} returned ${String(result)}`);
  } finally {
    db.close();
  }
}

/**
 * Backs up `dbPath` with VACUUM INTO, verifies the copy, then prunes older backups of the same
 * database to the newest `keep`. Throws `backup failed: <cause>` on any failure and removes a
 * target it created, so a failed run never counts as a backup. Spec §7, §13.
 * @param {{ dbPath: string; backupDir: string; keep?: number; now?: Date }} opts
 * @returns {{ path: string; pruned: string[] }}
 */
export function backupDatabase(opts) {
  const keep = opts.keep ?? DEFAULT_KEEP;
  const base = basename(opts.dbPath, extname(opts.dbPath));
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const target = join(opts.backupDir, `${base}-${stamp}.db`);
  let created = false;
  try {
    if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
    mkdirSync(opts.backupDir, { recursive: true });
    if (existsSync(target)) throw new Error(`backup target already exists: ${target}`);
    const db = new Database(opts.dbPath, { fileMustExist: true, timeout: 5000 });
    try {
      // why: VACUUM INTO reads one consistent snapshot, so it is safe while the app is writing.
      db.prepare('VACUUM INTO ?').run(target);
      created = true;
    } finally {
      db.close();
    }
    verifyBackup(target);
  } catch (err) {
    if (created) rmSync(target, { force: true });
    throw new Error(`backup failed: ${message(err)}`);
  }
  // why: prune only after the new copy is verified, and only files this script names.
  const pattern = new RegExp(`^${escapeRegExp(base)}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.db$`);
  const ours = readdirSync(opts.backupDir).filter((f) => pattern.test(f)).sort();
  const pruned = ours.slice(0, Math.max(0, ours.length - keep)).map((f) => join(opts.backupDir, f));
  for (const f of pruned) rmSync(f);
  return { path: target, pruned };
}

/**
 * @param {string[]} argv
 * @returns {{ db: string; dir: string; keep: number }}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] ?? '';
    const value = argv[i + 1];
    if (!['--db', '--dir', '--keep'].includes(name)) throw new Error(`unknown argument ${name}`);
    if (value === undefined) throw new Error(`${name} needs a value`);
    flags[name] = value;
  }
  // why: the CLI is an operator tool outside the packages, so it reads DATABASE_PATH directly;
  // inside the container compose sets it to /data/get-me-there.db.
  const db = flags['--db'] ?? process.env.DATABASE_PATH ?? '/data/get-me-there.db';
  return { db, dir: flags['--dir'] ?? join(dirname(db), 'backups'), keep: Number(flags['--keep'] ?? DEFAULT_KEEP) };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const r = backupDatabase({ dbPath: args.db, backupDir: args.dir, keep: args.keep });
    console.log(JSON.stringify({ ok: true, path: r.path, pruned: r.pruned }));
  } catch (err) {
    console.error(message(err));
    process.exit(1);
  }
}
```

`.gitignore`: append one line `backups/`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --project infra backup`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/backup.mjs .gitignore infra/test && git commit -m "wp12: VACUUM INTO backup with integrity check and keep-5 retention"
```

### Task 12.5: Pre-migration preflight in the bootstraps

**Files:**
- Create: `apps/api/src/bootstrap/preflight.ts`
- Modify: `apps/api/src/bootstrap/app.ts`, `apps/api/src/bootstrap/tool.ts`
- Test: `apps/api/test/bootstrap/preflight.test.ts`, `apps/api/test/bootstrap/preMigrationBoot.test.ts`

**Interfaces:**
- Consumes: `scripts/backup.mjs` (Task 12.4), `Config`, `Logger` (WP0), `openDatabase` (WP0), the WP8 bootstraps.
- Produces: `assertDataDirWritable`, `loadBackupModule`, `preflight`, `PreflightError`, `BackupModule`, `PreflightResult`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/bootstrap/preflight.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@gmt/db';
import type { Logger } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { PreflightError, assertDataDirWritable, loadBackupModule, preflight } from '../../src/bootstrap/preflight.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gmt-preflight-'));
}

function logger(): Logger {
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
  return log;
}

function journal(dir: string): string {
  const m = join(dir, 'drizzle');
  mkdirSync(join(m, 'meta'), { recursive: true });
  writeFileSync(join(m, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [{ idx: 0, version: '6', when: 1_760_400_000_000, tag: '0000_init', breakpoints: true }] }));
  return m;
}

function dbWithMigrations(dir: string, appliedAt: number | null): string {
  const path = join(dir, 'get-me-there.db');
  const db = openDatabase(path);
  db.raw.exec('CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  if (appliedAt !== null) db.raw.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run('h', appliedAt);
  db.close();
  return path;
}

describe('assertDataDirWritable (spec §13: boot fails clearly if /data is not writable)', () => {
  it('names the directory and the fix when it cannot write', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'data'), 'a file, not a directory');
    expect(() => assertDataDirWritable(join(dir, 'data', 'get-me-there.db'))).toThrow(PreflightError);
    expect(() => assertDataDirWritable(join(dir, 'data', 'get-me-there.db'))).toThrow(/DATABASE_PATH directory .*data is not writable.*named volume/);
  });
  it('passes on a writable directory and leaves no probe file behind', () => {
    const dir = tempDir();
    assertDataDirWritable(join(dir, 'get-me-there.db'));
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('preflight (spec §7 Migrations)', () => {
  it('does nothing for an in-memory database', async () => {
    const backup = { pendingMigrations: vi.fn(), backupDatabase: vi.fn() };
    await expect(preflight({ databasePath: ':memory:' }, { migrationsDir: '/nowhere', log: logger(), backup })).resolves.toEqual({ pending: [], backupPath: null });
    expect(backup.pendingMigrations).not.toHaveBeenCalled();
  });

  it('takes no backup on a fresh install (no database file yet)', async () => {
    const dir = tempDir();
    const r = await preflight({ databasePath: join(dir, 'get-me-there.db') }, { migrationsDir: journal(dir), log: logger(), backup: await loadBackupModule() });
    expect(r).toEqual({ pending: [], backupPath: null });
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('takes no backup when no migration is pending', async () => {
    const dir = tempDir();
    const db = dbWithMigrations(dir, 1_760_400_000_000);
    const r = await preflight({ databasePath: db }, { migrationsDir: journal(dir), log: logger(), backup: await loadBackupModule() });
    expect(r).toEqual({ pending: [], backupPath: null });
  });

  it('backs up under <db dir>/backups when migrations are pending, and logs it', async () => {
    const dir = tempDir();
    const db = dbWithMigrations(dir, null);
    const log = logger();
    const r = await preflight({ databasePath: db }, { migrationsDir: journal(dir), log });
    expect(r.pending).toEqual(['0000_init']);
    expect(r.backupPath).toMatch(/[/\\]backups[/\\]get-me-there-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/);
    expect(existsSync(r.backupPath ?? '')).toBe(true);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ pending: ['0000_init'], backupPath: r.backupPath }), 'pre-migration backup written');
  });

  it('refuses migrations and boot when the backup fails, naming the cause', async () => {
    const dir = tempDir();
    const db = dbWithMigrations(dir, null);
    writeFileSync(join(dir, 'backups'), 'not a directory');
    await expect(preflight({ databasePath: db }, { migrationsDir: journal(dir), log: logger() })).rejects.toThrow(/pre-migration backup failed, migrations refused: backup failed/);
  });
});
```

`apps/api/test/bootstrap/preMigrationBoot.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@gmt/db';
import { describe, expect, it } from 'vitest';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A database whose migrations table is empty, so every migration is pending, and a backup dir that cannot exist. */
function brokenBackupSetup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gmt-boot-'));
  const dbPath = join(dir, 'get-me-there.db');
  const db = openDatabase(dbPath);
  db.raw.exec('CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  db.close();
  writeFileSync(join(dir, 'backups'), 'not a directory');
  return dbPath;
}

function tables(dbPath: string): string[] {
  const db = openDatabase(dbPath);
  const names = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all() as string[];
  db.close();
  return names;
}

const env = (dbPath: string) => ({ PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_PATH: dbPath, BIND_ADDRESS: '127.0.0.1', PORT: '39123' });

describe('the real bootstraps run the pre-migration backup first (spec §7 Migrations)', () => {
  it.each([
    ['app', ['--import', 'tsx', 'src/bootstrap/app.ts']],
    ['tool', ['--import', 'tsx', 'src/bootstrap/tool.ts', 'smoke']],
  ])('%s: a failed backup refuses migrations and boot', (_name, args) => {
    const dbPath = brokenBackupSetup();
    const r = spawnSync(process.execPath, args, { cwd: API_ROOT, env: env(dbPath), encoding: 'utf8', timeout: 60_000 });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/pre-migration backup failed, migrations refused/);
    expect(tables(dbPath)).toEqual(['__drizzle_migrations']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/api test -- bootstrap/pre`
Expected: FAIL, `Failed to load url ../../src/bootstrap/preflight.js`; the spawn test fails because the bootstrap migrates the database (its table list gains the WP3 tables) or exits for another reason without the expected message.

- [ ] **Step 3: Implement**

`apps/api/src/bootstrap/preflight.ts`:

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Config, Logger } from '@gmt/core';

/** The part of scripts/backup.mjs the bootstraps use. Spec §7 "Migrations". */
export interface BackupModule {
  pendingMigrations(dbPath: string, migrationsDir: string): string[];
  backupDatabase(opts: { dbPath: string; backupDir: string; keep?: number; now?: Date }): { path: string; pruned: string[] };
}

export interface PreflightResult {
  pending: string[];
  backupPath: string | null;
}

/** A boot refusal whose message tells the operator what to fix. */
export class PreflightError extends Error {
  override name = 'PreflightError';
}

// why: four levels up from src/bootstrap/ and from dist/bootstrap/ alike is the repository root
// (or /app in the image), where scripts/backup.mjs lives.
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Fails boot with a clear message when the database directory cannot be written, which is
 * what happens with a bind mount owned by root or a read-only volume. Spec §13.
 */
export function assertDataDirWritable(databasePath: string): void {
  const dir = dirname(resolve(databasePath));
  const probe = join(dir, `.gmt-write-probe-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
    rmSync(probe);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new PreflightError(
      `DATABASE_PATH directory ${dir} is not writable by uid ${process.getuid?.() ?? 'unknown'} (${code}). ` +
        'In Docker use the named volume from docker-compose.yml; for a bind mount, chown the host directory to 1000:1000.',
    );
  }
}

/** Loads scripts/backup.mjs at runtime; the script is plain ESM shared with the operator CLI. */
export async function loadBackupModule(repoRoot: string = REPO_ROOT): Promise<BackupModule> {
  const url = pathToFileURL(join(repoRoot, 'scripts', 'backup.mjs')).href;
  return (await import(url)) as BackupModule;
}

/**
 * Runs before `buildPorts` (which applies migrations) in both bootstraps:
 * 1. the database directory must be writable;
 * 2. when migrations are pending, a VACUUM INTO backup goes to `<db dir>/backups` first;
 * 3. if that backup fails, boot fails here, so migrations never run without one.
 * Spec §7 "Migrations", §13.
 */
export async function preflight(
  config: Pick<Config, 'databasePath'>,
  opts: { migrationsDir: string; log: Logger; backup?: BackupModule },
): Promise<PreflightResult> {
  if (config.databasePath === ':memory:') return { pending: [], backupPath: null };
  assertDataDirWritable(config.databasePath);
  const backup = opts.backup ?? (await loadBackupModule());
  let pending: string[];
  try {
    pending = backup.pendingMigrations(config.databasePath, opts.migrationsDir);
  } catch (err) {
    throw new PreflightError(`cannot read the migration state of ${config.databasePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (pending.length === 0) return { pending, backupPath: null };
  try {
    const r = backup.backupDatabase({ dbPath: config.databasePath, backupDir: join(dirname(config.databasePath), 'backups') });
    opts.log.info({ pending, backupPath: r.path, pruned: r.pruned }, 'pre-migration backup written');
    return { pending, backupPath: r.path };
  } catch (err) {
    throw new PreflightError(`pre-migration backup failed, migrations refused: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

`apps/api/src/bootstrap/app.ts`: add the import and one statement in `main()`, immediately before the `buildPorts(` call, using the same `config`, `log` and `migrationsDir` values that call receives:

```ts
import { preflight } from './preflight.js';
// … inside main(), directly above `const ports = buildPorts(config, { … migrationsDir })`:
  // why: buildPorts applies migrations; the backup must exist first or boot stops (spec §7).
  await preflight(config, { migrationsDir, log });
```

`apps/api/src/bootstrap/tool.ts`: the same import and the same statement in `runTool`, directly above its `buildPorts(` call.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/api test`
Expected: PASS, including 7 preflight tests and 2 spawn tests; coverage stays at or above 85% lines / 70% branches; `src/bootstrap/preflight.ts` shows 100% lines.

Then: `node scripts/check-boundaries.mjs && pnpm -r typecheck`
Expected: exit 0 for both (preflight.ts imports only `@gmt/core` types and Node built-ins; it reads no `process.env`).

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "wp12: pre-migration backup and /data writability check before migrations"
```

### Task 12.6: `docs/api-limits.md` with the generated preset table

**Files:**
- Create: `docs/api-limits.md`, `infra/test/presetTable.ts`
- Test: `infra/test/apiLimits.test.ts`

**Interfaces:**
- Consumes: `PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS` (WP0).
- Produces: `renderPresetTable()` (test helper).

- [ ] **Step 1: Write the failing test**

`infra/test/presetTable.ts`:

```ts
import { PLAN_PRESETS, TRAVELPAYOUTS_DEFAULTS } from '../../packages/core/src/config/presets.js';

type PresetField = keyof (typeof PLAN_PRESETS)['trial'];
interface Row { field: PresetField; unit: 'count' | 'text' | 'microGbp'; overrides: string[]; planOnly: boolean }

/** One row per preset field, in display order, with the variables that override it (spec §12). */
export const ROWS: readonly Row[] = [
  { field: 'monthlyCallCap', unit: 'count', overrides: ['SEARCHAPI_MONTHLY_CALL_CAP', 'TRAVELPAYOUTS_MONTHLY_CALL_CAP'], planOnly: false },
  { field: 'window', unit: 'text', overrides: [], planOnly: false },
  { field: 'billingDay', unit: 'count', overrides: ['SEARCHAPI_BILLING_DAY', 'TRAVELPAYOUTS_BILLING_DAY'], planOnly: false },
  { field: 'ratePerMinute', unit: 'count', overrides: ['SEARCHAPI_RATE_PER_MINUTE', 'TRAVELPAYOUTS_RATE_PER_MINUTE'], planOnly: false },
  { field: 'ratePerHour', unit: 'count', overrides: ['SEARCHAPI_RATE_PER_HOUR', 'TRAVELPAYOUTS_RATE_PER_HOUR'], planOnly: false },
  { field: 'concurrency', unit: 'count', overrides: ['SEARCHAPI_CONCURRENCY', 'TRAVELPAYOUTS_CONCURRENCY'], planOnly: false },
  { field: 'cacheTtlHours', unit: 'count', overrides: ['SEARCHAPI_CACHE_TTL_HOURS', 'TRAVELPAYOUTS_CACHE_TTL_HOURS'], planOnly: false },
  { field: 'costPerCallMicroGbp', unit: 'microGbp', overrides: ['SEARCHAPI_COST_PER_CALL_MICRO_GBP'], planOnly: false },
  { field: 'planFixedMicroGbp', unit: 'microGbp', overrides: ['SEARCHAPI_PLAN_FIXED_PENCE'], planOnly: false },
  { field: 'excludedFromSchedule', unit: 'text', overrides: [], planOnly: false },
  { field: 'monthlySpendCapMicroGbp', unit: 'microGbp', overrides: ['MONTHLY_SPEND_CAP_PENCE'], planOnly: true },
  { field: 'executionMaxCalls', unit: 'count', overrides: ['EXECUTION_MAX_CALLS'], planOnly: true },
  { field: 'executionMaxCostMicroGbp', unit: 'microGbp', overrides: ['EXECUTION_MAX_COST_PENCE'], planOnly: true },
];

function cell(value: unknown, unit: Row['unit']): string {
  if (value === undefined) return '—';
  if (unit === 'microGbp') return `${String(value)} µGBP (${Number(value) / 10_000}p)`;
  return String(value);
}

/** The markdown table docs/api-limits.md must carry between its preset-table markers. */
export function renderPresetTable(): string {
  const lines = [
    '| Field | Override variable | SearchApi `trial` | SearchApi `40usd` | Travelpayouts (schema defaults) |',
    '|---|---|---|---|---|',
  ];
  for (const r of ROWS) {
    const override = r.overrides.length > 0 ? r.overrides.map((v) => `\`${v}\``).join(' / ') : '— (fixed by plan)';
    const tp = r.planOnly ? undefined : TRAVELPAYOUTS_DEFAULTS[r.field as keyof typeof TRAVELPAYOUTS_DEFAULTS];
    lines.push(`| \`${r.field}\` | ${override} | ${cell(PLAN_PRESETS.trial[r.field], r.unit)} | ${cell(PLAN_PRESETS['40usd'][r.field], r.unit)} | ${cell(tp, r.unit)} |`);
  }
  return lines.join('\n');
}
```

`infra/test/apiLimits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLAN_PRESETS, TRAVELPAYOUTS_DEFAULTS } from '../../packages/core/src/config/presets.js';
import { between, read } from './helpers.js';
import { ROWS, renderPresetTable } from './presetTable.js';

describe('docs/api-limits.md preset table (spec §12)', () => {
  it('covers every preset field of every plan and every Travelpayouts default', () => {
    const fields = ROWS.map((r) => r.field).sort();
    expect(fields).toEqual(Object.keys(PLAN_PRESETS.trial).sort());
    expect(fields).toEqual(Object.keys(PLAN_PRESETS['40usd']).sort());
    for (const key of Object.keys(TRAVELPAYOUTS_DEFAULTS)) expect(fields).toContain(key);
  });

  it('matches the table rendered from PLAN_PRESETS and TRAVELPAYOUTS_DEFAULTS', () => {
    const doc = between(read('docs/api-limits.md'), '<!-- preset-table:start -->\n', '\n<!-- preset-table:end -->');
    expect(doc).toBe(renderPresetTable());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project infra apiLimits`
Expected: FAIL on the second test, `ENOENT … docs/api-limits.md`; the first test passes.

- [ ] **Step 3: Implement**

`docs/api-limits.md`:

````markdown
# Provider limits, plan presets and reconciliation

Every limit below is enforced by the app before a request leaves the process: the ledger
(`provider_requests`) records each attempt, and a request that would cross a cap is refused
before it is sent. Configuration lives in `.env` (see `.env.example`); this page explains
what the values mean. Provider facts were measured on 2026-10-14 and come from
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
  and recording only. If some credits were spent elsewhere, set `SEARCHAPI_TRIAL_USED` to the
  number used (100 minus the dashboard's "Remaining free searches (credits)").
- **`40usd`** is the subscription. Each call costs 0 at the margin; the fee (£32, entered as
  3200p) is counted once in the global monthly cap, which defaults to 3500p, so
  `MONTHLY_SPEND_CAP_PENCE` reads as total monthly spend. The 10,000-call cap is the hard
  stop. The hourly rate of 2,000 is the vendor's "20% of the plan per hour" rule.
- **Travelpayouts** is free and never billed; its call cap only bounds load. The vendor allows
  600 requests a minute on this endpoint; the app defaults to 200.
- `EXECUTION_MAX_FREE_CALLS` (default 2000), `SOFT_CONFIRM_PENCE` (100) and
  `CHILD_MAX_CALLS` (6) are not plan-dependent and are not in the table.
- A billed provider enabled under a spend cap of 0 makes boot log a warning and the Providers
  page say "verification will not run: spend cap is 0".

## Budget windows

Each provider's month starts on its `<PROVIDER>_BILLING_DAY` (UTC, 1–28, so every month has
the day); the global month starts on `GLOBAL_BILLING_DAY` (UTC, default 1). Set SearchApi's
billing day to the day your subscription renews so the app's month and the vendor's month
line up. `trial` uses a lifetime window. `GET /budget` and the Providers page show every
window's start and end with calls and cost so far.

## Per-provider facts

### Travelpayouts (Aviasales Data API): authorised, cached, free

- Endpoint `/aviasales/v3/prices_for_dates`, one request per (destination, month) with
  `departure_at=YYYY-MM`, `one_way=false`, `currency=gbp`, up to 1000 rows a page. When every
  origin shares a metro code in the airports table the request uses it (`LON` for LHR and
  LGW) and rows are attributed by their `origin_airport` field. The worked example (2 origins,
  2 destinations, 7 months) costs 14 requests a scan, or 28 by airport.
- Prices are Aviasales users' own recent searches (within about 48 hours), so the app labels
  them "Aviasales cache" with an age bound of 48 h. Rows carry no `found_at`.
- The vendor ignores `market` (point of sale is recorded as unknown) and `trip_class`
  (economy only; other cabins return no data with a note).
- Coverage depends on what users searched: a thin long-haul route measured zero cached rows
  over eight months, busy gateways four to six a month. Run the coverage check on the
  Definitions form before relying on it.
- The token travels in the `X-Access-Token` header, never in a URL.

### SearchApi (Google Flights engines): scraping-derived, opt-in

- SearchApi obtains Google's results in a way Google's terms prohibit; the app uses it because
  the operator opted in (decision 2026-10-14) and labels every price "Google Flights via
  SearchApi".
- `google_flights_calendar` (discovery): at most 200 date combinations per call (HTTP 400
  above that), one airport per side (city codes are rejected), 9 to 29 seconds per call. The
  app tiles 8 outbound × 24 return days, about 23 calls per airport pair for a 182-day window;
  the worked example's 4 pairs need about 92. Age bound 24 h.
- `google_flights` (verification): three steps per cell, `1 + expandTop × 2` calls, 5 at the
  default `expandTop` of 2. Step 3 can show an online agency below the airline's fare, so it
  always runs. Some options carry no price and are skipped.
- Billing: only HTTP 200 responses count; error responses are not billed, and a repeat answered
  from the vendor's cache was not billed either (dashboard, 2026-10-14). The app's ledger counts
  every HTTP 200 attempt, so it can read higher than the dashboard, never lower.
- The key travels in an `Authorization: Bearer` header, never in a URL.

## Reconciling with the vendor dashboard

Once a week (or before raising a cap), compare the app with SearchApi's dashboard:

1. Open the Providers page (or `GET /budget`) and note SearchApi's calls in the current
   window and the window's start date.
2. Open SearchApi's dashboard and note the searches used in the same billing period
   (on `trial`, 100 minus "Remaining free searches (credits)").
3. Expect **app ≥ dashboard**. The gap is cached repeats and retries the vendor did not bill.
4. If the **dashboard is higher**, something outside this install used the key, or the
   database was restored from a backup (below). Lower `SEARCHAPI_MONTHLY_CALL_CAP` to
   `10000 − dashboard used` (or raise `SEARCHAPI_TRIAL_USED` on `trial`) and restart with
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

Run: `pnpm vitest run --project infra apiLimits`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add docs/api-limits.md infra/test && git commit -m "wp12: api-limits doc with the preset table generated from PLAN_PRESETS"
```

### Task 12.7: `docs/scheduling.md`, `docs/setup.md`, the example JSON, banned-word scan

**Files:**
- Create: `docs/scheduling.md`, `docs/setup.md`, `docs/examples/london-new-york.json`
- Test: `infra/test/docs.test.ts`

**Interfaces:**
- Consumes: `definitionCreateRequestSchema`, `findBannedWords` (WP0).
- Produces: `docs/examples/london-new-york.json` (the WP9 contract).

- [ ] **Step 1: Write the failing test**

`infra/test/docs.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definitionCreateRequestSchema } from '../../packages/core/src/api-contract/index.js';
import { findBannedWords } from '../../packages/core/src/text/bannedWords.js';
import { ROOT, SPEC_PATH, between, read } from './helpers.js';

/** Operator-facing docs, held to the spec §11 word list. */
const SCANNED = ['api-limits.md', 'scheduling.md', 'setup.md'];
/** Research notes that quote vendor terminology verbatim; not operator-facing text. */
const EXCLUDED = ['providers.md'];
/** Exact phrases allowed although they contain a banned word: the script name from spec §9 item 7. */
const ALLOWLIST = ['smoke:live'];

const example = JSON.parse(read('docs/examples/london-new-york.json')) as unknown;

describe('docs/setup.md example definition (spec §1, §11)', () => {
  it('the JSON block in setup.md is exactly docs/examples/london-new-york.json', () => {
    const block = between(read('docs/setup.md'), '<!-- example-definition:start -->\n```json\n', '\n```\n<!-- example-definition:end -->');
    expect(JSON.parse(block)).toEqual(example);
  });

  it('parses with definitionCreateRequestSchema', () => {
    const r = definitionCreateRequestSchema.safeParse(example);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });

  it('is the worked example with the spec §11 form defaults', () => {
    expect(example).toMatchObject({
      origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'],
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, minNights: 10, maxNights: 21, cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
      verification: { maxCells: 10, topN: 10, expandTop: 2, bookingLinks: true, alwaysInclude: [] },
      providers: { discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 } },
      scheduleCron: '0 5 * * 1', scheduleTz: 'Europe/London',
    });
  });
});

describe('docs/scheduling.md (spec §8.2)', () => {
  it('carries every row of the spec §8.2 cadence table verbatim', () => {
    const section = between(read(SPEC_PATH), '**Cadence arithmetic**', 'There is no built-in definition');
    const rows = section.split('\n').filter((l) => l.startsWith('|'));
    expect(rows.length).toBe(5);
    const doc = read('docs/scheduling.md');
    for (const row of rows) expect(doc).toContain(row);
  });
});

describe('banned words in operator docs (spec §11)', () => {
  it('scans every docs/*.md except the research notes', () => {
    const all = readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).sort();
    expect(all).toEqual([...SCANNED, ...EXCLUDED].sort());
  });

  it.each(SCANNED)('%s contains no banned word', (file) => {
    const text = read(`docs/${file}`);
    const hits = findBannedWords(text, ALLOWLIST).map((h) => `${h.word} @${h.index}: …${text.slice(Math.max(0, h.index - 30), h.index + 30)}…`);
    expect(hits).toEqual([]);
  });

  it('the allowlist is needed (setup.md names the smoke script)', () => {
    expect(findBannedWords(read('docs/setup.md')).map((h) => h.word)).toContain('live');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project infra docs`
Expected: FAIL, `ENOENT … docs/examples/london-new-york.json` while collecting `docs.test.ts`.

- [ ] **Step 3: Implement**

`docs/examples/london-new-york.json`:

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

`docs/scheduling.md`:

````markdown
# Scheduling

A definition with a schedule runs on its own; the app has one in-process scheduler and needs
no host cron for searches. Times are evaluated in the definition's time zone
(`scheduleTz`, which new definitions take from `SCHEDULER_TIMEZONE`, default
`Europe/London`), so 05:00 stays 05:00 local across the clock changes.

## Cron examples

Five fields: minute, hour, day of month, month, day of week. Schedules more frequent than
hourly are rejected when you save.

| Cron | Meaning | Fits |
|---|---|---|
| `0 5 * * 1` | Mondays 05:00 (the default) | every configuration |
| `0 5 * * 1,4` | Mondays and Thursdays 05:00 | £0, and $40 with room to spare |
| `0 5 * * *` | every day 05:00 | $40 only (about 4,300 calls a month for the worked example) |
| `30 6 1,15 * *` | 1st and 15th of the month 06:30 | every configuration |

Avoid 01:00–02:59 in `Europe/London`: on the March change that hour does not exist and on
the October change it happens twice. Pick an hour outside it.

The definition's `discoveryRefreshHours` (default 168, one week) decides when a calendar price
is old enough to fetch again. A price younger than 90% of it is reused rather than refetched,
so a weekly schedule refreshes weekly and a daily schedule under a 168 h refresh mostly reuses.
Lower `discoveryRefreshHours` to match a faster schedule.

## Cadence and the call budget

Calls per run come from the same functions as the estimate shown on the Definitions form. The
worked example is 2 origins × 2 destinations (4 pairs) over a 182-day window with 10–21
nights.

| Config | Per run | Per month (weekly) | Fits |
|---|---|---|---|
| £0 Travelpayouts, `month` tiles | `O × D × M` free calls, or `D × M` with a shared metro (worked example 14) | ~60 | yes, cap 50,000; usefulness is whatever the coverage check reports for the pairs |
| SearchApi $40, weekly discovery, `maxCells 10, expandTop 2, bookingLinks true` | ~23 tiles per pair + `maxCells × 5` (worked example ~92 + 50 = ~142) | ~615 of 10,000 | yes: ~£32 subscription, marginal cost 0; the call cap is the hard stop; headroom for `maxCells` ~200 (~1,090/run) or daily runs (~4,300/month) |
| SearchApi trial | one discovery exceeds 100 | — | spike and smoke only; scheduled runs exclude SearchApi on `trial` |

When you save a definition, the form shows `budgetFit`: runs per month × the estimate,
compared with every cap. A warning there means the schedule will meet a cap before the month
ends.

## Pausing

- **Stop a schedule:** untick "enabled" on the definition (or `PUT /definitions/:id` with
  `"enabled": false`). The job is removed at once; turning it back on re-registers it.
- **Cancel a run in progress:** the Cancel button on the status bar. Cells not yet fetched go
  back to "not searched"; Resume continues from there later.
- **Paused by the app:** a run stops itself as `paused_budget` (a cap was reached) or
  `paused_error` (every provider failed, or the rate limiter's queue deadline passed). The
  status bar shows the reason. A budget pause resumes by itself when the cap window reopens; an
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
`MAX_AUTO_RESUMES` times without progress, default 3).
````

`docs/setup.md`:

````markdown
# Setup

This gets one container running on a machine you control, reachable only by you, with a
backup routine. Everything below uses the worked example London → New York; replace the
airports with your own in the Definitions form.

## 1. Authentication first

The container listens on all interfaces inside Docker and compose publishes it on
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

Never put `NODE_ENV`, `IN_CONTAINER` or `ALLOW_FIXTURE_PROVIDER` in `.env` for the container:
compose does not pass them (the image sets the first two), and fixture data cannot be enabled
in a container.

## 3. Reaching it from other devices: ALLOWED_HOSTS and TLS

The app rejects any request whose `Host` header is not in `ALLOWED_HOSTS`, and the error names
both the header value and the variable. The default is `localhost:3000,127.0.0.1:3000`.
Setting the variable replaces the default, so list every hostname you will type in a
browser, including the local ones if you still use them.

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
`X-Forwarded-For`; set it only when a proxy you control sits in front. Keep port 3000 bound to
`127.0.0.1` (as compose does) so the proxy is the only way in.

`ALLOW_UNAUTHENTICATED=true` exists for a host reachable only over Tailscale and run outside
compose with the app bound to a non-loopback address. With compose, keep auth on.

## 4. Import the example definition

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
on the 10 cheapest calendar cells with 2 outbound options each.

On the £0 configuration, replace the `providers` block before importing:

```json
"providers": { "discovery": ["travelpayouts"], "verification": [], "discoveryRefreshHours": { "travelpayouts": 168 } }
```

The form shows the estimate before you create the definition; creating it is your
confirmation of that cost.

## 5. Backups

The database is one file on the named volume, `/data/get-me-there.db` inside the container.
The app backs it up by itself before applying a schema migration (on an upgrade) and refuses
to start if that backup fails. For routine backups, run the same script on demand:

```bash
docker compose exec -T app node scripts/backup.mjs
```

It writes `/data/backups/get-me-there-<UTC timestamp>.db` with SQLite `VACUUM INTO` (safe
while the app runs), checks it with `PRAGMA integrity_check`, refuses to overwrite an existing
file, keeps the newest 5 inside the volume, and exits non-zero on any failure.

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

The database holds prices, history and the request ledger, not your API keys or passwords
(those are kept only in `.env`). Back up `.env` separately and keep it private.

### Restore

1. Stop the app: `docker compose stop app`.
2. Replace the database on the volume and delete its WAL side files, using a throwaway
   container that mounts the volume and the folder holding the backup:

   ```bash
   docker run --rm \
     -v get-me-there_gmt-data:/data \
     -v "$PWD/backups":/restore:ro \
     --entrypoint sh get-me-there:local -c '
       rm -f /data/get-me-there.db-wal /data/get-me-there.db-shm &&
       cp /restore/get-me-there-2026-10-14T03-15-00-000Z.db /data/get-me-there.db'
   ```

   The image runs as `node` (uid 1000), so the restored file has the right owner.
3. Start: `docker compose start app`.
4. Restoring resets month-to-date spend: ledger rows written after the backup are gone. Lower
   the caps and reconcile with the vendor dashboard before the next run, as described in
   `docs/api-limits.md` ("Restoring a backup resets month-to-date spend").

## 6. Expected database growth

These are estimates from the row counts of one run of the worked example (8,736 cells); the
daily maintenance job logs the measured database size (`dbBytes`), which is the number to
trust.

| Configuration, weekly schedule | Rows per run | Approximate growth |
|---|---|---|
| £0 (Travelpayouts only) | ~8,700 cell rows + ~8,700 outcome rows + a few hundred prices | ~4 MB a run, ~20 MB a month |
| $40 (both providers) | ~8,700 cell rows + ~26,000 outcome rows + up to ~8,700 calendar prices + ~100 itinerary observations | ~11 MB a run, ~50 MB a month |

Growth scales with cells (origins × destinations × window days × nights) and with runs per
month. Expired cache rows and old cache-hit ledger rows are pruned daily; run history is
kept, so a year of the $40 example is roughly 600 MB.

**Docker Desktop (macOS, Windows):** keep the database on the named volume. Bind-mounting a
host folder over `/data` goes through Docker Desktop's file-sharing layer, where SQLite's WAL
locking is not reliable and the database can be corrupted. Use a bind mount only to copy
backups out (as in the restore step above), never for the working database file. On a Linux host
a bind mount works if the directory is owned by uid 1000; the app stops at boot with a message
naming the directory if it cannot write there.

## 7. Smoke test and fixture recording inside the container

While the app runs it holds the database lock, so the smoke test and the recorder run inside
the app process through authenticated routes. The image has no `curl`, so call them from the
host through the loopback port:

```bash
curl -u "operator:choose-a-long-passphrase" -X POST \
  -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -d '{}' http://127.0.0.1:3000/tools/smoke

curl -u "operator:choose-a-long-passphrase" -X POST \
  -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -d '{"budget":12}' http://127.0.0.1:3000/tools/record
```

The smoke test issues one request per configured provider and prints the cheapest price with
its provenance. Recording spends SearchApi credits up to the budget you pass.

On a development checkout without the container the same tools are `pnpm smoke:live` and
`pnpm record:fixtures --budget 12`.

## 8. Local development

```bash
pnpm install
pnpm dev                    # api + web with hot reload, database at ./data/dev.db
pnpm test
docker compose --profile dev up -d mailpit   # optional: catch alert email locally
```

With Mailpit running, a development `.env` can send mail to it:

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

Run: `pnpm vitest run --project infra docs`
Expected: PASS (9 tests: 3 example, 1 cadence, 1 scan-set, 3 per-file scans, 1 allowlist). If a banned-word test fails, the failure lists `word @index: …context…`; reword that sentence (never extend the allowlist beyond the script name).

- [ ] **Step 5: Commit**

```bash
git add docs/setup.md docs/scheduling.md docs/examples infra/test && git commit -m "wp12: setup and scheduling docs with the importable London to New York example"
```

### Task 12.8: Docker build in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the image (Task 12.1), compose file (Task 12.3), backup CLI (Task 12.4), `/health` (WP8).

- [ ] **Step 1: Write the failing check**

Run locally, before editing CI (the same commands the job will run):

```bash
docker build --tag get-me-there:ci . \
&& docker compose config --quiet \
&& test "$(docker run --rm --entrypoint id get-me-there:ci -u)" = "1000" \
&& docker run -d --name gmt-ci -p 127.0.0.1:3000:3000 \
     -e DATABASE_PATH=/data/get-me-there.db \
     -e APP_BASIC_AUTH_USER=ci -e APP_BASIC_AUTH_PASS=ci-password-0123 get-me-there:ci \
&& sleep 60 && docker inspect --format '{{.State.Health.Status}}' gmt-ci
```

Expected before Task 12.1–12.5 are complete: a failure at the first missing piece. With them complete: `healthy` (or `starting` if the first boot is still seeding; the CI step below polls). Clean up with `docker rm -f gmt-ci`.

- [ ] **Step 2: Implement**

Add this job to `.github/workflows/ci.yml` under `jobs:` (after the existing `test` job; the WP0 grep step stays as it is):

```yaml
  docker:
    # Spec §13: the image builds from the lockfile, runs as node with the production flags,
    # boots to healthy on a fresh volume, and can back itself up.
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image
        run: docker buildx build --load --tag get-me-there:ci .
      - name: Compose file is valid
        run: docker compose config --quiet
      - name: Image runs as node with the production flags
        run: |
          test "$(docker run --rm --entrypoint id get-me-there:ci -u)" = "1000"
          docker run --rm --entrypoint node get-me-there:ci -e "process.exit(process.env.NODE_ENV === 'production' && process.env.IN_CONTAINER === '1' ? 0 : 1)"
      - name: Container boots and becomes healthy
        run: |
          docker run -d --name gmt-ci -p 127.0.0.1:3000:3000 \
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
          curl -fsS http://127.0.0.1:3000/health
      - name: Backup runs inside the container
        run: docker exec gmt-ci node scripts/backup.mjs
      - name: Stop gracefully within the grace period
        if: always()
        run: docker stop --time 30 gmt-ci && docker rm gmt-ci
```

- [ ] **Step 3: Run to verify it passes**

Run: the Step 1 command block again, then `curl -fsS http://127.0.0.1:3000/health` and `docker exec gmt-ci node scripts/backup.mjs`, then `docker stop --time 30 gmt-ci && docker rm gmt-ci`.
Expected: `healthy`; `/health` prints `{"ok":true,"degraded":false}`; the backup prints `{"ok":true,"path":"/data/backups/get-me-there-….db","pruned":[]}`; the stop completes in under 30 s (the app checkpoints and exits on SIGTERM). After pushing the branch, the `docker` job is green.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "wp12: CI builds the image, boots it to healthy and runs a backup inside it"
```

### Task 12.9: The WP9 example constant equals the docs JSON

**Precondition:** WP9 has merged to `main`. Rebase this branch on `main` first (`git fetch && git rebase origin/main`); WP9's brief creates `apps/web/src/views/Definitions/exampleDefinition.ts` to the contract in "Interfaces produced". If WP9 has not merged when Tasks 12.1–12.8 are done, stop here, report to Fable, and leave this task unticked; WP12 is not done until it passes.

**Files:**
- Test: `infra/test/exampleDefinition.test.ts`

**Interfaces:**
- Consumes: `EXAMPLE_DEFINITION` (WP9), `docs/examples/london-new-york.json` (Task 12.7).

- [ ] **Step 1: Write the test**

`infra/test/exampleDefinition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DEFINITION } from '../../apps/web/src/views/Definitions/exampleDefinition.js';
import { read } from './helpers.js';

describe('the Definitions "import example" constant (spec §1, §11)', () => {
  it('equals docs/examples/london-new-york.json, the JSON in docs/setup.md', () => {
    expect(EXAMPLE_DEFINITION).toEqual(JSON.parse(read('docs/examples/london-new-york.json')));
  });

  it('writes no airport code in application source (it re-exports the docs JSON)', () => {
    const src = read('apps/web/src/views/Definitions/exampleDefinition.ts');
    expect(src).toContain('docs/examples/london-new-york.json');
    expect(src).not.toMatch(/\b(LHR|LGW|JFK|EWR|LON|NYC)\b/);
  });
});
```

- [ ] **Step 2: Run to verify it fails or passes**

Run: `pnpm vitest run --project infra exampleDefinition`
Expected: PASS when WP9 followed the contract. A failure is a WP9 defect (or a drift in the docs JSON): report it to Fable with the diff; do not edit WP9's file from this branch.

- [ ] **Step 3: Commit**

```bash
git add infra/test/exampleDefinition.test.ts && git commit -m "wp12: example constant in the web app equals the docs JSON"
```

## Pinned review-focus tests

None of the plan's five Review Focus lines is owned by WP12 (they belong to WP0, WP1, WP2, WP3, WP7, WP8, WP9 and WP10). The WP12-specific risks are pinned instead by: `compose.test.ts` "never passes NODE_ENV, ALLOW_FIXTURE_PROVIDER or IN_CONTAINER, and has no env_file" (synthetic gate, §5.5); `preMigrationBoot.test.ts` (backup before migrations through the real bootstraps, §7); `dockerfile.test.ts` "pnpm-lock.yaml pins 13.0.3 to the integrity recorded in the WP12 brief" (fail-closed prebuilt, §4).

## Definition of done

| Command | Expected |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | `Checked N files … No fixes applied`, exit 0 |
| `pnpm typecheck` | exit 0 (packages and `infra/tsconfig.json`) |
| `node scripts/check-boundaries.mjs` | exit 0 |
| `pnpm secret-scan` | `secret scan: clean` |
| `pnpm vitest run --project infra` | all infra tests PASS (dockerfile, envExample, compose, backup, apiLimits, docs, exampleDefinition); no coverage threshold |
| `pnpm --filter @gmt/api test` | PASS with lines ≥ 85%, branches ≥ 70% |
| `pnpm test` | every project PASS |
| `docker build -t get-me-there:local .` | succeeds; log shows `better-sqlite3 13.0.3 prebuilt ok` three times |
| `docker compose config --quiet` | exit 0, no output |
| `docker compose up -d && docker compose ps` (with a three-line `.env`) | `app` reaches `healthy` within 240 s |
| `docker compose exec -T app node scripts/backup.mjs` | one JSON line with `"ok":true` and a path under `/data/backups/` |
| `docker compose stop app` | stops within 30 s |
| CI on the branch | `test` and `docker` jobs green |

## Open questions

None.
