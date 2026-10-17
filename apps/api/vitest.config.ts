import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
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
