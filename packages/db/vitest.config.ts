import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  // why: WP16b (decision 78): fileURLToPath, not URL.pathname, which reads /D:/… on Windows and resolves nothing
  resolve: { alias: gmtAliases(fileURLToPath(new URL('../..', import.meta.url))) },
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/tempdirs.ts'],
    // why: the shared Windows runner timed database tests out at the default 5 s three times (2026-11-02, 2026-11-03
    // twice); CI's GMT_TIMING_FACTOR (3) scales the limit as it does every timing limit, and 1 leaves it as before
    testTimeout: 5000 * Number(process.env.GMT_TIMING_FACTOR ?? '1'),
    hookTimeout: 10000 * Number(process.env.GMT_TIMING_FACTOR ?? '1'),
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
