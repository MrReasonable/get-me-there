import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'web',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
    },
  },
});
