import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The repository root, found upwards from this file. why: Stryker runs this config from a sandbox copy nested under
 * the package (`.stryker-tmp/sandbox-…`), where a fixed `../..` would not be the root.
 */
function repoRoot(): string {
  for (let d = dirname(fileURLToPath(import.meta.url)); d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
  throw new Error('no pnpm-workspace.yaml above the worker');
}
const ROOT = repoRoot();

// The worker's floors (brief WP14 Task 14.1, decision 69): 90/80/90/90 for the package and 100 lines and branches for
// the eight safety modules (the classifier, the cool-down, the pacer, the consent read-back, the result grammar, the
// navigation guard, readiness and the account-cookie check). Coverage counts src/ only.
const SAFETY = { lines: 100, branches: 100 };
export default defineConfig({
  // why: the same source aliases as vitest.aliases.ts, inline, since a relative import of it fails in the sandbox too.
  resolve: {
    alias: [
      {
        find: /^@gmt\/providers\/testing$/,
        replacement: join(ROOT, 'packages/providers/src/testing/index.ts'),
      },
      { find: /^@gmt\/(core|providers)$/, replacement: join(ROOT, 'packages/$1/src/index.ts') },
    ],
  },
  test: {
    name: 'camoufox-worker',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 90,
        statements: 90,
        'src/classify.ts': SAFETY,
        'src/cooldown.ts': SAFETY,
        'src/pacer.ts': SAFETY,
        'src/socs.ts': SAFETY,
        'src/names.ts': SAFETY,
        'src/guard.ts': SAFETY,
        'src/ready.ts': SAFETY,
        'src/accountCookies.ts': SAFETY,
      },
    },
  },
});
