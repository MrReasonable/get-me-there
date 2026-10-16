#!/usr/bin/env node
// The project rule "no `as` except `as const`" (plan Global Constraints; decisions 43, 45), checked with the TypeScript
// parser rather than a grep, so prose, strings and renamed imports never match and every type spelling does. Reports
// each `x as T` whose T is not `const` and each `<T>x`, as file:line: text, and exits 1 when it finds one — or when it
// was given no file at all, so a pathspec typo or a run from the wrong directory can never pass by scanning nothing.
//
// Usage: node scripts/check-casts.mjs [file …]
// With no arguments it scans every tracked or new .ts/.tsx file under packages/*/{src,test} and apps/*/{src,test}, at
// any depth, plus the package-root and repository-root .ts config files.
// packages/core/src/types/ids.ts is the one exception: its as* helpers are the brand mint sites the rule allows.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const EXEMPT = new Set(['packages/core/src/types/ids.ts']);

function defaultFiles() {
  const out = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      // why: `:(glob)` makes `**/` match zero or more directories; a plain pathspec needs at least one, so files
      // directly under src/ or test/ were never scanned (code-architect review 1)
      ...['packages', 'apps'].flatMap((root) => [
        `:(glob)${root}/*/src/**/*.ts`,
        `:(glob)${root}/*/src/**/*.tsx`,
        `:(glob)${root}/*/test/**/*.ts`,
        `:(glob)${root}/*/test/**/*.tsx`,
        `:(glob)${root}/*/*.ts`,
      ]),
      ':(glob)*.ts',
    ],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter((f) => f !== '' && !EXEMPT.has(f));
}

/** Every non-`as const` assertion in one file, as "file:line: text". */
export function castsIn(file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const walk = (n) => {
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && n.type.getText(src) !== 'const') {
      const line = src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
      found.push(`${file}:${line}: ${n.getText(src).replace(/\s+/g, ' ').slice(0, 100)}`);
    }
    ts.forEachChild(n, walk);
  };
  walk(src);
  return found;
}

const files = process.argv.length > 2 ? process.argv.slice(2) : defaultFiles();
if (files.length === 0) {
  console.error('check-casts: no files to scan; refusing to pass on an empty list');
  process.exit(1);
}
const found = files.flatMap((f) => castsIn(f, readFileSync(f, 'utf8')));
for (const line of found) console.error(line);
console.log(`check-casts: ${files.length} files, ${found.length} casts`);
process.exit(found.length === 0 ? 0 : 1);
