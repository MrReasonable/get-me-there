#!/usr/bin/env node
// Enforces the spec §4 import graph by reading every package.json `dependencies` and every
// `import ... from '@gmt/…'` under src/. Fails on any edge not in ALLOWED, on `process.env`
// outside apps/api/src/bootstrap/, on msw imported outside providers' src/testing/, and on msw anywhere in apps/api.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = {
  '@gmt/core': [],
  '@gmt/db': ['@gmt/core'],
  '@gmt/providers': ['@gmt/core'],
  '@gmt/engine': ['@gmt/core', '@gmt/db', '@gmt/providers'],
  '@gmt/api': ['@gmt/core', '@gmt/db', '@gmt/providers', '@gmt/engine'],
  '@gmt/web': ['@gmt/core'],
};
const CORE_ALLOWED_EXTERNAL = ['zod', '@noble/hashes', '@date-fns/tz'];
const dirs = {
  '@gmt/core': 'packages/core',
  '@gmt/db': 'packages/db',
  '@gmt/providers': 'packages/providers',
  '@gmt/engine': 'packages/engine',
  '@gmt/api': 'apps/api',
  '@gmt/web': 'apps/web',
};
// The only files that may read process.env: the app and tool bootstraps (wiring and logger take the env as an argument).
const ENV_READERS = ['/bootstrap/'];
// Any static, side-effect or dynamic import of msw.
const MSW_IMPORT = /(from\s+|import\s*\(\s*|import\s+)['"]msw/;

function* walk(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(p)) yield p; // why: .mjs test-support files count too (arch-r3-002)
  }
}

let bad = 0;
for (const [name, dir] of Object.entries(dirs)) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep.startsWith('@gmt/') && !ALLOWED[name].includes(dep)) {
      console.error(`${name} may not depend on ${dep}`);
      bad++;
    }
    if (name === '@gmt/core' && !CORE_ALLOWED_EXTERNAL.includes(dep)) {
      console.error(`@gmt/core may not depend on ${dep}`);
      bad++;
    }
  }
  for (const f of walk(join(dir, 'src'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\s+['"](@gmt\/[a-z]+)/g)) {
      if (!ALLOWED[name].includes(m[1])) {
        console.error(`${f} imports ${m[1]}`);
        bad++;
      }
    }
    if (/process\.env/.test(src) && (name !== '@gmt/api' || !ENV_READERS.some((p) => f.includes(p)))) {
      console.error(`${f} reads process.env outside apps/api/src/bootstrap/`);
      bad++;
    }
    // why: plan decision 7 — @gmt/providers/testing is the only production-tree module that imports msw, in every package
    if (!(name === '@gmt/providers' && f.includes('/src/testing/')) && MSW_IMPORT.test(src)) {
      console.error(`${f} imports msw outside packages/providers/src/testing/`);
      bad++;
    }
  }
}
// why: plan decision 20 — apps/api tests reach msw only through @gmt/providers/testing (its network guards), never directly
const apiPkg = JSON.parse(readFileSync('apps/api/package.json', 'utf8'));
for (const field of ['dependencies', 'devDependencies']) {
  if (Object.hasOwn(apiPkg[field] ?? {}, 'msw')) {
    console.error(`@gmt/api lists msw in ${field}; use @gmt/providers/testing`);
    bad++;
  }
}
for (const f of walk('apps/api/test')) {
  if (MSW_IMPORT.test(readFileSync(f, 'utf8'))) {
    console.error(`${f} imports msw; apps/api tests use @gmt/providers/testing`);
    bad++;
  }
}
process.exit(bad ? 1 : 0);
