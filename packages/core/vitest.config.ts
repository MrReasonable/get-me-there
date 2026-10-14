import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'core',
    include: ['test/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
