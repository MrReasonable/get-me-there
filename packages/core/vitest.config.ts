import { defineConfig } from 'vitest/config';

// Package thresholds from the design spec §9. Coverage counts src/ only; only the package barrel src/index.ts is excluded (api-contract/index.ts holds `route` and ROUTES, so it is gated).
// why: no workspace aliases: core imports no other workspace package, and Stryker runs this config from a sandbox copy
// of packages/core (ruling 10, `inPlace: false`), where a path relative to the repository root would not resolve.
export default defineConfig({
  test: {
    name: 'core',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
