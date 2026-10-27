import { defineConfig } from 'vitest/config';

// why: one root config so `pnpm test` runs every package with its own thresholds; the `scripts` project runs the
// tests of the root scripts, which live beside them as `scripts/*.test.mjs` (decision 49).
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      {
        test: {
          name: 'scripts',
          include: ['scripts/*.test.mjs'],
          environment: 'node',
          // why: removes the temp directories the tests make and fails a file that leaves any behind
          setupFiles: ['scripts/test-tempdirs.mjs'],
        },
      },
    ],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
