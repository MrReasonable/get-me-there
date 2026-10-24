import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The repository root, found upwards from this file. why: WP16a's mutation run (Stryker, `inPlace: false`) runs this
 * config from a sandbox copy nested under the package (`.stryker-tmp/sandbox-…`), where a fixed `../..` would not be
 * the root (the worker's config does the same).
 */
function repoRoot(): string {
  for (let d = dirname(fileURLToPath(import.meta.url)); d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
  throw new Error('no pnpm-workspace.yaml above the cli');
}
const ROOT = repoRoot();
// why: review R29 — the one alias table, loaded by absolute path: a static relative import of vitest.aliases.ts would
// not resolve from Stryker's sandbox copy. The cli's own tests import its source relatively, so inside the sandbox
// they run the mutated copy.
// why: review S16 — a computed import is untyped, so the module and the table it returns are checked at run time
// rather than given a type unchecked
const ALIASES = aliasesFrom(await import(pathToFileURL(join(ROOT, 'vitest.aliases.ts')).href), ROOT);

function isAlias(x: unknown): x is { find: RegExp; replacement: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    'find' in x &&
    x.find instanceof RegExp &&
    'replacement' in x &&
    typeof x.replacement === 'string'
  );
}
function aliasesFrom(mod: unknown, root: string): Array<{ find: RegExp; replacement: string }> {
  if (
    typeof mod !== 'object' ||
    mod === null ||
    !('gmtAliases' in mod) ||
    typeof mod.gmtAliases !== 'function'
  )
    throw new Error('vitest.aliases.ts exports no gmtAliases function');
  const table: unknown = mod.gmtAliases(root);
  if (!Array.isArray(table) || !table.every(isAlias)) throw new Error('gmtAliases returned no alias table');
  return table;
}

// Brief WP16b §11: the package at 85% lines and 70% branches. Coverage counts src/ only; main.ts (the one environment
// reader and real-world wiring) is covered by the child-process tests, which v8 coverage does not see.
export default defineConfig({
  resolve: { alias: ALIASES },
  test: {
    name: 'cli',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
