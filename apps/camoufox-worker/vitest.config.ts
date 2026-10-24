import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// why: review R29 — the one alias table, loaded by absolute path: a static relative import of vitest.aliases.ts would
// not resolve from Stryker's sandbox copy. Review S16, ca-b1-023: the module checks its own table at run time
// (gmtAliasesChecked, shared with the other config); a computed import is untyped, so this checks only the export.
const ALIASES_MODULE: unknown = await import(pathToFileURL(join(ROOT, 'vitest.aliases.ts')).href);
if (
  typeof ALIASES_MODULE !== 'object' ||
  ALIASES_MODULE === null ||
  !('gmtAliasesChecked' in ALIASES_MODULE) ||
  typeof ALIASES_MODULE.gmtAliasesChecked !== 'function'
)
  throw new Error('vitest.aliases.ts exports no gmtAliasesChecked function');
const ALIASES = ALIASES_MODULE.gmtAliasesChecked(ROOT);

// The worker's floors (brief WP14 Task 14.1, decision 69): 90/80/90/90 for the package and 100 lines and branches for
// the eight safety modules (the classifier, the cool-down, the pacer, the consent read-back, the result grammar, the
// navigation guard, readiness and the account-cookie check). Coverage counts src/ only.
const SAFETY = { lines: 100, branches: 100 };
export default defineConfig({
  resolve: { alias: ALIASES },
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
        // why: WP15: the date grid's dated grammar joins the safety modules
        'src/gridNames.ts': SAFETY,
        // why: fix round 1 (TS 5): the rules that decide "nothing stored from this view" are safety rules too
        'src/gridView.ts': SAFETY,
      },
    },
  },
});
