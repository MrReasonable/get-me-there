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
      },
    },
  },
});
