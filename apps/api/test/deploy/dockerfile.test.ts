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
    // why: review code-architect M3 — /api/health answers 200 with {"ok":false} when the database check fails, so the
    // check reads `ok`; `degraded` stays out of it (decision 63) and Docker never restarts on unhealthy.
    expect(hc).toContain('r.json()');
    expect(hc).toContain('b.ok === true');
    expect(hc).not.toContain('degraded');
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

  it('installs from the manifests before the sources are copied, so a source edit keeps the install layer', () => {
    // why: review devops M1 — `COPY . .` before `pnpm install` re-ran a full install on every source change
    const build = stages.find((s) => s.from.endsWith(' AS build'))?.instructions ?? [];
    const prod = stages.find((s) => s.from.endsWith(' AS prod-deps'))?.instructions ?? [];
    const at = (list: string[], f: (i: string) => boolean) => list.findIndex(f);
    const installAt = (list: string[]) => at(list, (i) => /pnpm install --frozen-lockfile/.test(i));
    for (const list of [build, prod]) {
      const manifests = at(list, (i) =>
        i.startsWith('COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc '),
      );
      expect(manifests).toBeGreaterThanOrEqual(0);
      expect(manifests).toBeLessThan(installAt(list));
      for (const dir of [
        'packages/core',
        'packages/db',
        'packages/providers',
        'packages/engine',
        'apps/api',
        'apps/web',
      ])
        expect(list.some((i) => i.startsWith(`COPY ${dir}/package.json `))).toBe(true);
    }
    expect(at(build, (i) => i === 'COPY . .')).toBeGreaterThan(installAt(build));
    expect(prod).not.toContain('COPY . .');
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

  it('excludes build coverage output without excluding source folders named coverage', () => {
    // why: packages/core/src/coverage is source; a `**/coverage/` pattern dropped it from the context and broke the build
    expect(lines).not.toContain('**/coverage/');
    expect(lines).toContain('packages/*/coverage/');
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
