import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// why: the boundary script guards the whole repository, so it is run, not imported (it exits the process);
// a scratch tree holds only what it reads, with planted files (reviews tsr2-012, arch-r3-006; decision 49:
// tests of root scripts live beside them in scripts/*.test.mjs, run by the root Vitest project `scripts`).
const REPO = resolve(import.meta.dirname, '..');
const SCRIPT = join(REPO, 'scripts/check-boundaries.mjs');
const PACKAGES = [
  'packages/core',
  'packages/db',
  'packages/providers',
  'packages/engine',
  'apps/api',
  'apps/web',
];
let scratch = null;

/** A scratch repository with every package.json, the airports data and the given files. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'gmt-boundaries-'));
  for (const p of PACKAGES) {
    mkdirSync(join(root, p), { recursive: true });
    copyFileSync(join(REPO, p, 'package.json'), join(root, p, 'package.json'));
  }
  mkdirSync(join(root, 'packages/db/data'), { recursive: true });
  for (const f of readdirSync(join(REPO, 'packages/db/data')).filter((n) => n.endsWith('.json'))) {
    copyFileSync(join(REPO, 'packages/db/data', f), join(root, 'packages/db/data', f));
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  scratch = root;
  return root;
}

const run = (root) => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });

afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

// why: ruling 11: each case spawns node over a scratch tree; 60 s survives a loaded runner.
describe('scripts/check-boundaries.mjs place and suppression checks (decisions 36, 46)', {
  timeout: 60_000,
}, () => {
  it('a clean tree passes, with codes and cities in comments, identifiers and the two allowlisted files', () => {
    const r = run(
      tree({
        'apps/web/src/ok.ts':
          "// a JFK comment and London in prose\nconst ISO = 'ISO date'; export const ALL = 'ALL';\n",
        'apps/web/src/example.ts': "export const EXAMPLE_LABEL = 'London to New York'; const a = 'JFK';\n",
        'apps/api/src/tools/workedExample.ts': "export const X = ['LHR', 'JFK'];\n",
      }),
    );
    expect([r.status, r.stderr]).toEqual([0, '']);
  });

  it('a suppression inside real source named coverage (packages/core/src/coverage) still fails', () => {
    const r = run(
      tree({
        'packages/core/src/coverage/x.ts': `${['// @ts', '-ignore'].join('')}\n`,
        'packages/core/test/coverage/y.test.ts': `${['// biome', '-ignore lint/x: y'].join('')}\n`,
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      'packages/core/src/coverage/x.ts has a lint or type-check suppression comment',
    );
    expect(r.stderr).toContain(
      'packages/core/test/coverage/y.test.ts has a lint or type-check suppression comment',
    );
  });

  it('a generated coverage report directly under a package root is still skipped', () => {
    const r = run(
      tree({
        'packages/core/coverage/lcov-report/prettify.js': `${['// eslint', '-disable'].join('')}\n`,
        'apps/web/coverage/block-navigation.js': `${['// @ts', '-nocheck'].join('')}\n`,
      }),
    );
    expect([r.status, r.stderr]).toEqual([0, '']);
  });

  it('installed and generated trees are not scanned', () => {
    const r = run(
      tree({
        'apps/web/node_modules/dep/index.js': `${['// @ts', '-ignore'].join('')}\n`,
        'apps/web/dist/assets/x.js': `${['// eslint', '-disable'].join('')}\n`,
      }),
    );
    expect([r.status, r.stderr]).toEqual([0, '']);
  });

  it('an airport code or a metro city in a string literal fails, in web and api alike', () => {
    const r = run(
      tree({
        'apps/web/src/planted.tsx': "export const p = <p>{'from JFK'}</p>;\n",
        'apps/api/src/planted.ts': ['export const c = `New York $', '{1}`;\n'].join(''),
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('apps/web/src/planted.tsx names the airport code JFK');
    expect(r.stderr).toContain('apps/api/src/planted.ts names the city New York');
  });

  it.each([
    ['packages/db/test/x.test.ts', ['// biome', '-ignore lint/x: y'].join('')],
    ['packages/engine/src/y.ts', ['// @ts', '-expect-error why'].join('')],
    ['apps/web/src/z.tsx', ['const a = <p>{/* @ts', '-ignore */}</p>;'].join('')],
    ['packages/core/src/w.ts', ['/* eslint', '-disable */'].join('')],
    ['apps/api/test/v.test.ts', ['// @ts', '-nocheck'].join('')],
    ['apps/web/vite.config.ts', ['// biome', '-ignore lint/x: y'].join('')],
    ['apps/web/e2e/smoke.spec.ts', ['// @ts', '-ignore'].join('')],
  ])('a suppression comment fails in any package: %s', (path, text) => {
    const r = run(tree({ [path]: `${text}\n` }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${path} has a lint or type-check suppression comment`);
  });
});

/** A package manifest from the repository with extra fields merged into it, as planted file text. */
function manifest(pkgDir, extra) {
  const real = JSON.parse(readFileSync(join(REPO, pkgDir, 'package.json'), 'utf8'));
  const merged = { ...real };
  for (const [field, deps] of Object.entries(extra)) merged[field] = { ...(real[field] ?? {}), ...deps };
  return JSON.stringify(merged);
}

// why: CodeRabbit batch 3 — every rule the script enforces has a planted violation here, asserting its own stderr
// line, so a regression in any one check fails a test (the place and suppression checks are covered above).
describe('scripts/check-boundaries.mjs import-graph, process.env and msw rules (spec §4, decisions 7, 9, 20)', {
  timeout: 60_000,
}, () => {
  it('a static import across the graph fails: web may import only @gmt/core', () => {
    const r = run(
      tree({
        'apps/web/src/a.ts': "import { x } from '@gmt/db';\nexport { y } from '@gmt/engine';\n",
        'apps/web/src/ok.ts': "import { z } from '@gmt/core';\n",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('apps/web/src/a.ts imports @gmt/db');
    expect(r.stderr).toContain('apps/web/src/a.ts imports @gmt/engine');
    expect(r.stderr).not.toContain('ok.ts');
  });

  it('a dynamic or side-effect import across the graph fails too (CodeRabbit batch 3)', () => {
    const r = run(
      tree({
        'apps/web/src/lazy.ts': "export const load = () => import('@gmt/engine');\n",
        'apps/web/src/spaced.ts': "export const load = async () => await import ( '@gmt/providers' );\n",
        'apps/web/src/side.ts': "import '@gmt/db';\n",
        'apps/web/src/ok.ts': "import '@gmt/core';\nexport const c = () => import('@gmt/core');\n",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('apps/web/src/lazy.ts imports @gmt/engine');
    expect(r.stderr).toContain('apps/web/src/spaced.ts imports @gmt/providers');
    expect(r.stderr).toContain('apps/web/src/side.ts imports @gmt/db');
    expect(r.stderr).not.toContain('ok.ts');
  });

  it('a manifest dependency across the graph fails, and core may depend only on its allowlisted externals', () => {
    const r = run(
      tree({
        'apps/web/package.json': manifest('apps/web', { dependencies: { '@gmt/engine': 'workspace:*' } }),
        'packages/core/package.json': manifest('packages/core', { dependencies: { 'left-pad': '1.3.0' } }),
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('@gmt/web may not depend on @gmt/engine');
    expect(r.stderr).toContain('@gmt/core may not depend on left-pad');
  });

  it('process.env outside the api bootstrap fails, in any package', () => {
    const r = run(
      tree({
        'packages/core/src/a.ts': 'export const a = process.env.X;\n',
        'apps/api/src/routes/b.ts': 'export const b = process.env.Y;\n',
        'apps/api/src/bootstrap/start.ts': 'export const ok = process.env.Z;\n',
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('packages/core/src/a.ts reads process.env outside apps/api/src/bootstrap/');
    expect(r.stderr).toContain('apps/api/src/routes/b.ts reads process.env outside apps/api/src/bootstrap/');
    expect(r.stderr).not.toContain('apps/api/src/bootstrap/start.ts');
  });

  it('process.env is allowed in exactly apps/api/src/bootstrap/ and the scripts/*.mjs entry points (CodeRabbit batch 3)', () => {
    const r = run(
      tree({
        'apps/api/src/bootstrap/tool.ts': 'export const ok = process.env.A;\n',
        'scripts/backup.mjs': 'const db = process.env.DATABASE_PATH;\n',
        // a directory named bootstrap anywhere else is not the bootstrap
        'apps/api/src/routes/bootstrap/x.ts': 'export const x = process.env.B;\n',
        'packages/db/src/bootstrap/y.ts': 'export const y = process.env.C;\n',
        // only top-level .mjs files under scripts/ are entry points
        'scripts/lib/helper.mjs': 'export const h = process.env.D;\n',
        'scripts/op.js': 'const o = process.env.E;\n',
      }),
    );
    expect(r.status).toBe(1);
    for (const f of [
      'apps/api/src/routes/bootstrap/x.ts',
      'packages/db/src/bootstrap/y.ts',
      'scripts/lib/helper.mjs',
      'scripts/op.js',
    ])
      expect(r.stderr).toContain(`${f} reads process.env outside apps/api/src/bootstrap/ and scripts/*.mjs`);
    expect(r.stderr).not.toContain('apps/api/src/bootstrap/tool.ts');
    expect(r.stderr).not.toContain('scripts/backup.mjs');
  });

  it('msw imported outside packages/providers/src/testing/ fails; inside it passes', () => {
    const r = run(
      tree({
        'packages/engine/src/m.ts': "import { http } from 'msw';\n",
        'packages/providers/src/testing/server.ts': "import { setupServer } from 'msw/node';\n",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      'packages/engine/src/m.ts imports msw outside packages/providers/src/testing/',
    );
    expect(r.stderr).not.toContain('packages/providers/src/testing/server.ts');
  });

  it('msw in the apps/api manifests or tests fails: api tests reach it only through @gmt/providers/testing', () => {
    const r = run(
      tree({
        'apps/api/package.json': manifest('apps/api', { devDependencies: { msw: '2.0.0' } }),
        'apps/api/test/x.test.ts': "import { http } from 'msw';\n",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('@gmt/api lists msw in devDependencies; use @gmt/providers/testing');
    expect(r.stderr).toContain(
      'apps/api/test/x.test.ts imports msw; apps/api tests use @gmt/providers/testing',
    );
  });
});
