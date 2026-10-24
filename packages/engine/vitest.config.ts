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
  throw new Error('no pnpm-workspace.yaml above the engine');
}
const ROOT = repoRoot();
// why: review R29 — the one alias table, loaded by absolute path: a static relative import of vitest.aliases.ts would
// not resolve from Stryker's sandbox copy. The engine's own tests import its source relatively, so inside the sandbox
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

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
// why: the layer-A harness lives under test/support, so src/ holds production code only.
export default defineConfig({
  resolve: { alias: ALIASES },
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 85,
        statements: 85,
        // why: the alert runner decides what the operator is told about a fare (WP11 review TS-12), so it keeps a higher floor
        'src/alerts/**': { lines: 95, branches: 80, functions: 95, statements: 95 },
      },
    },
  },
});
