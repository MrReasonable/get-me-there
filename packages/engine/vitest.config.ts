import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// Package thresholds from the design spec §9. Coverage counts src/ only; barrels are excluded.
// why: the layer-A harness lives under test/support, so src/ holds production code only.
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
