#!/usr/bin/env node
// Enforces the spec §4 import graph by reading every package.json `dependencies` and every
// `import ... from '@gmt/…'` under src/. Fails on any edge not in ALLOWED, on `process.env`
// outside the api bootstrap files, and on msw imported outside providers' src/testing/.
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
// The only files that may read process.env (plan: wiring, logger and the two bootstraps).
const ENV_READERS = ['/bootstrap/', '/wiring.ts', '/logger.ts'];

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
    else if (/\.(ts|tsx)$/.test(p)) yield p;
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
      console.error(`${f} reads process.env outside apps/api bootstrap/, wiring.ts or logger.ts`);
      bad++;
    }
    if (name === '@gmt/providers' && !f.includes('/src/testing/') && /from ['"]msw/.test(src)) {
      console.error(`${f} imports msw outside src/testing/`);
      bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
