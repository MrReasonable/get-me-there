#!/usr/bin/env node
// Enforces the spec §4 import graph by reading every package.json `dependencies` and every
// `import ... from '@gmt/…'` under src/. Fails on any edge not in ALLOWED, on `process.env`
// outside apps/api/src/bootstrap/, on msw imported outside providers' src/testing/, on msw anywhere in apps/api, on
// an airport code or a metro city name in a string literal of apps/web/src or apps/api/src outside the two
// worked-example files, and on a lint or type-check suppression comment anywhere in a package (root configs and e2e folders included).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ALLOWED = {
  '@gmt/core': [],
  '@gmt/db': ['@gmt/core'],
  '@gmt/providers': ['@gmt/core'],
  '@gmt/engine': ['@gmt/core', '@gmt/db', '@gmt/providers'],
  '@gmt/api': ['@gmt/core', '@gmt/db', '@gmt/providers', '@gmt/engine'],
  '@gmt/web': ['@gmt/core'],
};
const CORE_ALLOWED_EXTERNAL = ['zod', '@noble/hashes', '@date-fns/tz'];
// Three-letter words that appear in string literals and are also dataset airport codes (decision 46): currencies,
// HTTP, formats, standards and plain English. A later package adds the words it needs here, in its own diff.
const NOT_AIRPORT_WORDS = [
  'ALL',
  'AND',
  'API',
  'APG',
  'BST',
  'CAP',
  'CET',
  'CLI',
  'CSS',
  'CSV',
  'DIR',
  'DOM',
  'END',
  'ENV',
  'EST',
  'FOR',
  'GBP',
  'GET',
  'GMT',
  'ISO',
  'KEY',
  'MAX',
  'MIN',
  'NEW',
  'NOT',
  'OFF',
  'OUT',
  'PDF',
  'PNG',
  'POS',
  'RUN',
  'SQL',
  'SRC',
  'SVG',
  'TOP',
  'WAL',
];
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

// why: generated or installed trees are never source: dependencies, build output, coverage and test reports.
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report']);

function* walk(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (SKIPPED_DIRS.has(n)) continue;
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
// why: spec §1 and plan decisions 36, 46: nothing about a specific place exists in application code. A place
// lives in data, so only string literals, template text and JSX text are read (comments and identifiers are
// not): an airport or metro code from the shipped dataset, or the city name of any metro's airports. Only these
// two files may name the worked example's places.
const PLACE_ALLOWLIST = ['apps/web/src/example.ts', 'apps/api/src/tools/workedExample.ts'];
const PLACE_TREES = ['apps/web/src', 'apps/api/src'];
const NOT_AIRPORTS = new Set(NOT_AIRPORT_WORDS);
const dataDir = 'packages/db/data';
const airportsFile = readdirSync(dataDir).find((f) => /^airports\..+\.json$/.test(f));
const airports = JSON.parse(readFileSync(join(dataDir, airportsFile), 'utf8')).airports;
const metros = JSON.parse(readFileSync(join(dataDir, 'metros.json'), 'utf8')).metros;
const codes = new Set([...airports.map((a) => a.iata), ...Object.keys(metros)]);
const metroAirports = new Set(Object.values(metros).flat());
const cities = [
  ...new Set(airports.filter((a) => metroAirports.has(a.iata) && a.city !== '').map((a) => a.city)),
];
const cityPattern = new RegExp(
  `(?<![/\\w])(${cities.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?!\\w)`,
  'g',
);

/** The text a file renders or stores: string literals, template pieces and JSX text, never comments or names. */
function literalTexts(file, src) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every place name a file's literals hold. */
function placeOffenders(file, src) {
  const out = [];
  for (const text of literalTexts(file, src)) {
    for (const m of text.matchAll(/(?<![\w-])[A-Z]{3}(?![\w-])/g)) {
      if (codes.has(m[0]) && !NOT_AIRPORTS.has(m[0])) out.push(`${file} names the airport code ${m[0]}`);
    }
    for (const m of text.matchAll(cityPattern)) out.push(`${file} names the city ${m[1]}`);
  }
  return out;
}

for (const tree of PLACE_TREES) {
  for (const f of walk(tree)) {
    if (PLACE_ALLOWLIST.includes(f)) continue;
    for (const problem of placeOffenders(f, readFileSync(f, 'utf8'))) {
      console.error(`${problem}; only ${PLACE_ALLOWLIST.join(' and ')} may`);
      bad++;
    }
  }
}

// why: decisions 46, 49: the one suppression check. No lint or type-check suppression comment in any package's
// src or test; no scoped lint override is granted, so code that needed one is restructured instead.
const SUPPRESSIONS = '(?:biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck)';
const SUPPRESSION_COMMENT = new RegExp(`//[^\\n]*${SUPPRESSIONS}|/\\*(?:(?!\\*/)[\\s\\S])*${SUPPRESSIONS}`);
for (const dir of Object.values(dirs)) {
  // why: the whole package directory, so root configs (vite.config.ts, vitest.config.ts) and e2e folders count too.
  for (const f of walk(dir)) {
    if (SUPPRESSION_COMMENT.test(readFileSync(f, 'utf8'))) {
      console.error(`${f} has a lint or type-check suppression comment (decisions 46, 49)`);
      bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
