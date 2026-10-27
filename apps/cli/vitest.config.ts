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
// not resolve from Stryker's sandbox copy. Review S16, ca-b1-023: the module checks its own table at run time
// (gmtAliasesChecked, shared with the other config); a computed import is untyped, so this checks only the export.
const ALIASES_MODULE: unknown = await import(pathToFileURL(join(ROOT, 'vitest.aliases.ts')).href);
if (
  typeof ALIASES_MODULE !== 'object' ||
  ALIASES_MODULE === null ||
  !('gmtAliasesChecked' in ALIASES_MODULE) ||
  typeof ALIASES_MODULE.gmtAliasesChecked !== 'function'
)
  throw new Error('vitest.aliases.ts exports no gmtAliasesChecked function');
const ALIASES = ALIASES_MODULE.gmtAliasesChecked(ROOT);

// Brief WP16b §11: the package at 85% lines and 70% branches. Coverage counts src/ only; main.ts (the one environment
// reader and real-world wiring) is covered by the child-process tests, which v8 coverage does not see.
export default defineConfig({
  resolve: { alias: ALIASES },
  test: {
    name: 'cli',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/tempdirs.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
