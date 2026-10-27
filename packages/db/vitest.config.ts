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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
