import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'providers',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 85,
        branches: 70,
        functions: 85,
        statements: 85,
        // why: the adapter and the shared adapter helpers hold to a higher floor, enforced here rather than read by eye
        // (WP6 ts2-006); a glob threshold applies to the files it matches, beside the package-wide floor.
        'src/travelpayouts/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/shared/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        // why: the SearchApi adapter holds to its own floor so the package average cannot mask it (plan decision 31).
        'src/searchapi/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        // why: WP14 Task 14.8: the camoufox adapter holds to its own floor beside the package's.
        'src/camoufox/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
      },
    },
  },
});
