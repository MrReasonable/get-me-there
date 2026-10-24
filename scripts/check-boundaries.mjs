#!/usr/bin/env node
// Enforces the spec §4 import graph by reading every package.json `dependencies` and every import of '@gmt/…' under
// src/, from the parsed source (static, side-effect, require and dynamic imports alike; never comments or strings). Fails on any edge not in ALLOWED, on `process.env`
// outside apps/api/src/bootstrap/ and the scripts/*.mjs entry points, on msw imported outside providers' src/testing/, on msw anywhere in apps/api, on
// an airport code or a metro city name in a string literal of apps/web/src or apps/api/src outside the two
// worked-example files, and on a lint or type-check suppression comment anywhere in a package (root configs and e2e folders included).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { GENERATED_AT_PACKAGE_ROOT } from './generated-dirs.mjs';

const ALLOWED = {
  '@gmt/core': [],
  '@gmt/db': ['@gmt/core'],
  '@gmt/providers': ['@gmt/core'],
  '@gmt/engine': ['@gmt/core', '@gmt/db', '@gmt/providers'],
  '@gmt/api': ['@gmt/core', '@gmt/db', '@gmt/providers', '@gmt/engine'],
  '@gmt/web': ['@gmt/core'],
  // why: WP14 (decision 69, arch-009): the host-side worker speaks to the app over HTTP; it imports core only, and its
  // tests may take @gmt/providers/testing (the decision-61 skip guard) and nothing else of providers.
  '@gmt/camoufox-worker': ['@gmt/core'],
  // why: decision 72 (WP16b): the gmt CLI reaches the app and the worker over HTTP or as child processes, never by import.
  '@gmt/cli': ['@gmt/core'],
};
/** The worker's browser libraries, allowed only in its launch and driver modules (arch-009, TS-04). */
const WORKER_BROWSER_LIBS = ['camoufox-js', 'playwright-core'];
const WORKER_BROWSER_FILES = /^apps\/camoufox-worker\/src\/(launch|driver)\.ts$/;
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
  '@gmt/camoufox-worker': 'apps/camoufox-worker',
  '@gmt/cli': 'apps/cli',
};
// why: the only code that may read process.env is a command-line entry point: the app and tool bootstraps under
// exactly apps/api/src/bootstrap/ (wiring and logger take the env as an argument), and the operator scripts directly
// under scripts/ (backup.mjs reads DATABASE_PATH as the bootstrap does; secret-scan.mjs reads the configured secret
// values). Anchored to the path start, so a directory named bootstrap elsewhere (apps/api/src/routes/bootstrap/) or a
// helper nested under scripts/ is not an entry point (CodeRabbit batch 3).
// why: WP14: the camoufox worker's one launcher, run.ts, is its only environment reader (SEC-R2-006); decision 72: the
// gmt CLI's entry module, apps/cli/src/main.ts, is its only one.
const ENV_READER =
  /^(?:apps\/api\/src\/bootstrap\/.+|apps\/camoufox-worker\/src\/run\.ts|apps\/cli\/src\/main\.ts|scripts\/[^/]+\.mjs)$/;
const ENV_RULE =
  'apps/api/src/bootstrap/, apps/camoufox-worker/src/run.ts, apps/cli/src/main.ts and scripts/*.mjs entry points';
/**
 * Every module specifier a file imports, read from the parsed source: static imports and re-exports, bare side-effect
 * imports, `import x = require()`, `require()`, `import()` types and dynamic `import()` with a string or template
 * literal. A dynamic import whose specifier is computed is returned as null (it cannot be checked). why: PR #3 review —
 * a text scan missed import(`@gmt/engine`) and read an import written in a comment as real.
 */
function importsOf(file, src) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const literal = (n) =>
    n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  const visit = (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined)
      out.push(literal(n.moduleSpecifier));
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference))
      out.push(literal(n.moduleReference.expression));
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument))
      out.push(literal(n.argument.literal));
    else if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require'))
    )
      out.push(literal(n.arguments[0]));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const isMsw = (spec) => spec === 'msw' || spec.startsWith('msw/');

// why: installed dependencies are never source, at any depth. Build output, reports and a mutation run's sandbox are
// generated only directly under a package root, so they are skipped there by path and never by bare name
// (packages/core/src/coverage/ is real source and must stay covered); the list is the scripts' one copy (R37).

function* walk(dir, skipGeneratedHere = false) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (n === 'node_modules' || (skipGeneratedHere && GENERATED_AT_PACKAGE_ROOT.has(n))) continue;
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
    const specs = importsOf(f, src);
    for (const spec of specs) {
      if (spec === null) {
        console.error(
          `${f} has a dynamic import whose specifier is computed, so its package edge cannot be checked`,
        );
        bad++;
        continue;
      }
      const pkg = /^(@gmt\/[a-z]+)/.exec(spec)?.[1];
      if (pkg !== undefined && !ALLOWED[name].includes(pkg)) {
        console.error(`${f} imports ${pkg}`);
        bad++;
      }
    }
    if (/process\.env/.test(src) && !ENV_READER.test(f)) {
      console.error(`${f} reads process.env outside ${ENV_RULE}`);
      bad++;
    }
    for (const spec of specs)
      if (
        spec !== null &&
        WORKER_BROWSER_LIBS.some((l) => spec === l || spec.startsWith(`${l}/`)) &&
        !WORKER_BROWSER_FILES.test(f)
      ) {
        console.error(`${f} imports ${spec}; only apps/camoufox-worker/src/launch.ts and driver.ts may`);
        bad++;
      }
    // why: plan decision 7 — @gmt/providers/testing is the only production-tree module that imports msw, in every package
    if (
      !(name === '@gmt/providers' && f.includes('/src/testing/')) &&
      specs.some((x) => x !== null && isMsw(x))
    ) {
      console.error(`${f} imports msw outside packages/providers/src/testing/`);
      bad++;
    }
  }
}
// why: nothing imports the worker (decision 69): no package depends on it, and no source or test names it.
for (const [name, dir] of Object.entries(dirs)) {
  if (name === '@gmt/camoufox-worker') continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies'])
    if (Object.hasOwn(pkg[field] ?? {}, '@gmt/camoufox-worker')) {
      console.error(`${name} lists @gmt/camoufox-worker in ${field}; nothing may import the worker`);
      bad++;
    }
  for (const f of [...walk(join(dir, 'src')), ...walk(join(dir, 'test'))])
    if (importsOf(f, readFileSync(f, 'utf8')).some((x) => x?.startsWith('@gmt/camoufox-worker'))) {
      console.error(`${f} imports @gmt/camoufox-worker; nothing may`);
      bad++;
    }
}
// why: the worker's tests reach the workspace only through @gmt/core and @gmt/providers' testing export, and
// @gmt/providers is its only @gmt devDependency (WP14 fix round 1, arch M10: every @gmt specifier, not only providers).
const WORKER_TEST_SPECS = new Set(['@gmt/core', '@gmt/providers/testing']);
for (const f of walk('apps/camoufox-worker/test'))
  for (const spec of importsOf(f, readFileSync(f, 'utf8')))
    if (spec?.startsWith('@gmt/') && !WORKER_TEST_SPECS.has(spec)) {
      console.error(
        `${f} imports ${spec}; worker tests may import only @gmt/core and @gmt/providers/testing`,
      );
      bad++;
    }
{
  const dev = Object.keys(
    JSON.parse(readFileSync('apps/camoufox-worker/package.json', 'utf8')).devDependencies ?? {},
  );
  const gmt = dev.filter((d) => d.startsWith('@gmt/'));
  if (gmt.length !== 1 || gmt[0] !== '@gmt/providers') {
    console.error(
      `@gmt/camoufox-worker's @gmt devDependencies must be exactly @gmt/providers (found ${gmt.join(', ') || 'none'})`,
    );
    bad++;
  }
}

// The operator scripts are source too; their tests are not scanned, as no package's test/ tree is.
for (const f of walk('scripts')) {
  if (/\.test\.mjs$/.test(f)) continue;
  if (/process\.env/.test(readFileSync(f, 'utf8')) && !ENV_READER.test(f)) {
    console.error(`${f} reads process.env outside ${ENV_RULE}`);
    bad++;
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
  if (importsOf(f, readFileSync(f, 'utf8')).some((x) => x !== null && isMsw(x))) {
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
    // why: a hyphen is a boundary, so both codes of a route key such as 'LHR-JFK' are read (CodeRabbit batch 3);
    // words that then match are listed in NOT_AIRPORT_WORDS
    for (const m of text.matchAll(/(?<!\w)[A-Z]{3}(?!\w)/g)) {
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
  for (const f of walk(dir, true)) {
    if (SUPPRESSION_COMMENT.test(readFileSync(f, 'utf8'))) {
      console.error(`${f} has a lint or type-check suppression comment (decisions 46, 49)`);
      bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
