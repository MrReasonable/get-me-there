import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('scripts/check-boundaries.mjs place and suppression checks (decisions 36, 46)', () => {
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
