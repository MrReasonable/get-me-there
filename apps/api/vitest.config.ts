import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The repository root, found upwards from this file. why: WP18's mutation run (Stryker, `inPlace: false`) runs this
 * config from a sandbox copy nested under the package (`.stryker-tmp/sandbox-…`), where a fixed `../..` is not the root.
 */
function repoRoot(): string {
  for (let d = dirname(fileURLToPath(import.meta.url)); d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
  throw new Error('no pnpm-workspace.yaml above the api');
}
const ROOT = repoRoot();
// why: the one alias table, loaded by absolute path (a static relative import would not resolve from the sandbox)
const ALIASES_MODULE: unknown = await import(pathToFileURL(join(ROOT, 'vitest.aliases.ts')).href);
if (
  typeof ALIASES_MODULE !== 'object' ||
  ALIASES_MODULE === null ||
  !('gmtAliases' in ALIASES_MODULE) ||
  typeof ALIASES_MODULE.gmtAliases !== 'function'
)
  throw new Error('vitest.aliases.ts exports no gmtAliases function');
const ALIASES = ALIASES_MODULE.gmtAliases(ROOT);

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  // why: WP16b (decision 78): fileURLToPath, not URL.pathname, which reads /D:/… on Windows and resolves nothing
  resolve: { alias: ALIASES },
  test: {
    name: 'api',
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
        // why: the read model and the routes carry the provenance and coverage rules (spec §6.9, §8.1, §10); a file
        // there cannot hide behind the package average (review TS-7).
        'src/read/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        'src/routes/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
      },
    },
  },
});
