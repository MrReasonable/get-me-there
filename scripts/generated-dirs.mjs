// The directories a package's build, test and mutation runs generate directly under its root (WP16a review R37): the
// one list the boundary check and the mutation-glob check both skip. why: each is gitignored (.gitignore lists dist/,
// coverage/, test-results/, playwright-report/, .stryker-tmp/ and reports/); a new generated directory goes in both
// places, and scripts/generated-dirs.test.mjs fails until it does. node_modules is skipped at any depth on its own.
export const GENERATED_AT_PACKAGE_ROOT = new Set([
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.stryker-tmp',
  'reports',
]);
