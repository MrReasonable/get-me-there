import { defineConfig } from 'vitest/config';

// why: one root config so `pnpm test` runs every package with its own thresholds.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
