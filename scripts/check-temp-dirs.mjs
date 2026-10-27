#!/usr/bin/env node
// The rule "a test removes every temporary directory it makes". Tests make directories through the helpers in
// test/support/tempdirs.ts (one copy per package) and scripts/test-tempdirs.mjs, which track each directory and remove
// it after the test or the file, and fail a file that leaves anything behind. This check keeps the rule from lapsing:
//   1. no test or test-support file calls mkdtemp / mkdtempSync / fs.promises.mkdtemp, except those helpers;
//   2. the package copies of tempdirs.ts are byte for byte the same (Stryker runs a package from a sandbox copy, so
//      each package carries its own), and each is listed in its package's vitest `setupFiles`.
// It reads files only, never walks a temp directory.
//
// Usage: node scripts/check-temp-dirs.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The packages that carry a copy of the helper, each with the config that lists it as a setup file. */
export const HELPER_PACKAGES = [
  'apps/api',
  'apps/camoufox-worker',
  'apps/cli',
  'packages/db',
  'packages/providers',
];
const HELPER = 'test/support/tempdirs.ts';
/** The files allowed to name mkdtemp: the helpers themselves, and this check's own test, whose samples spell it. */
export const APPROVED = new Set([
  ...HELPER_PACKAGES.map((p) => `${p}/${HELPER}`),
  'scripts/test-tempdirs.mjs',
  'scripts/check-temp-dirs.test.mjs',
]);

/** A test file or test-support file, anywhere in the workspace (not a build output or an installed package). */
export function isTestFile(path) {
  if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path)) return false;
  if (/(^|\/)(node_modules|dist|\.stryker-tmp)\//.test(path)) return false;
  return /^(apps|packages)\/[^/]+\/(test|e2e)\//.test(path) || /^scripts\/[^/]*\.test\.mjs$/.test(path);
}

/** Each place `text` makes a temporary directory with mkdtemp, as "file:line: text". */
export function mkdtempIn(file, text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (/\bmkdtemp(Sync)?\b/.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return found;
}

/** Problems with the package copies of the helper: a missing or differing copy, or one no config lists. */
export function helperProblems(read) {
  const problems = [];
  const copies = HELPER_PACKAGES.map((p) => [p, read(`${p}/${HELPER}`)]);
  const [, reference] = copies[0];
  for (const [p, text] of copies) {
    if (text !== reference) problems.push(`${p}/${HELPER} differs from ${HELPER_PACKAGES[0]}/${HELPER}`);
    if (!read(`${p}/vitest.config.ts`).includes(`'${HELPER}'`))
      problems.push(`${p}/vitest.config.ts does not list '${HELPER}' in setupFiles`);
  }
  if (!read('vitest.config.ts').includes("'scripts/test-tempdirs.mjs'"))
    problems.push(
      "vitest.config.ts does not list 'scripts/test-tempdirs.mjs' in the scripts project's setupFiles",
    );
  return problems;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((f) => f !== '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = trackedFiles().filter(isTestFile);
  if (files.length === 0) {
    console.error('check-temp-dirs: no test files found; refusing to pass on an empty list');
    process.exit(1);
  }
  const found = [
    ...files.filter((f) => !APPROVED.has(f)).flatMap((f) => mkdtempIn(f, readFileSync(f, 'utf8'))),
    ...helperProblems((f) => readFileSync(f, 'utf8')),
  ];
  for (const line of found) console.error(line);
  console.log(`check-temp-dirs: ${files.length} test files, ${found.length} problems`);
  process.exit(found.length === 0 ? 0 : 1);
}
