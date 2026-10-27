import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The repository root, found upwards from this file. why: WP19's mutation run (Stryker, `inPlace: false`) runs this
 * config from a sandbox copy nested under the package (`.stryker-tmp/sandbox-…`), where a fixed `../..` is not the
 * root; the same reason and the same loader as apps/api's config (WP18).
 */
function repoRoot(): string {
  for (let d = dirname(fileURLToPath(import.meta.url)); d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
  throw new Error('no pnpm-workspace.yaml above the web app');
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

/** Provenance and booking safety components and the URL parsers: a gap here is a provenance or link gap (spec §9 item 6). */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };
/** WP10's pure view-model modules carry their own floor above the package's (review TS-8). */
const VIEW_MODEL = { lines: 95, branches: 85, functions: 95, statements: 95 };

// Package thresholds from the design spec §9 (web 70% lines, 60% branches); the safety-critical files are held at 100%.
// Coverage counts src/ only; barrels and the browser entry point are excluded.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      ...ALIASES,
      // why: src/example.ts reads the worked example from the repository's docs by a relative path, which from the
      // mutation sandbox points inside apps/web; this maps it to the one file wherever the config runs from
      { find: /^(?:\.\.\/)+docs\/examples\//, replacement: `${join(ROOT, 'docs', 'examples')}/` },
    ],
  },
  test: {
    name: 'web',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'jsdom',
    // why: an absolute origin, so the client's new URL(path, origin) gives msw an interceptable absolute URL.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    // why: Vitest 5's default, pinned (review arch2-003): each worker is its own Node process, where assigning
    // process.env.TZ re-detects the zone; 'threads' would ignore it (vitest v5.0.3 docs/config/pool.md).
    pool: 'forks',
    // why: the Playwright smoke lives in e2e/ and runs only through `pnpm --filter @gmt/web e2e` (spec §9 item 6).
    exclude: ['e2e/**', 'node_modules/**'],
    // why: setup-tz first so the zone is set before anything touches Date; setup-charts sizes Recharts in jsdom.
    setupFiles: ['test/setup-tz.ts', 'test/setup.ts', 'test/setup-charts.ts'],
    // why: review T3 — above testing-library's 5 s wait (test/setup.ts), so a findBy that never matches reports its
    // own error rather than a test timeout, and a test with several waits has room on a loaded machine
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
        'src/components/{Provenance,PriceCell,PriceBoundary,BookingAction}.tsx': FULL,
        'src/state/{urlState,resultsState,parse,datesState}.ts': FULL,
        'src/lib/**': VIEW_MODEL,
        'src/views/{History,Dates}/*.ts': VIEW_MODEL,
      },
    },
  },
});
