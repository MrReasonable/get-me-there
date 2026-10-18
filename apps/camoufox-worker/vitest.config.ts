import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

// The worker's floors (brief WP14 Task 14.1, decision 69): 90/80/90/90 for the package and 100 lines and branches for
// the eight safety modules (the classifier, the cool-down, the pacer, the consent read-back, the result grammar, the
// navigation guard, readiness and the account-cookie check). Coverage counts src/ only.
const SAFETY = { lines: 100, branches: 100 };
export default defineConfig({
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
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
