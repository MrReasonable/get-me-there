import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: review code-architect M5 — two test files each ran `pnpm --filter @gmt/api... build`, and under the root
// `pnpm test` they run in parallel, so one tsc could rewrite a dist file the other's script was importing. One script
// builds under a lock and skips when no source is newer than the last build; both files call it.
const REPO = join(import.meta.dirname, '..');
const ensure = () =>
  execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 600_000,
  }).trim();

describe('scripts/ensure-build.mjs', () => {
  it('builds when needed and then reports the build up to date, without rebuilding', () => {
    ensure();
    expect(ensure()).toBe('build up to date');
  }, 600_000);

  it('is the only thing the CLI tests use to build', () => {
    for (const f of ['scripts/backup.test.mjs', 'apps/api/test/deploy/backupCli.test.ts']) {
      const text = readFileSync(join(REPO, f), 'utf8');
      expect(text, f).toContain('ensure-build.mjs');
      expect(text, f).not.toMatch(/'@gmt\/api\.\.\.', 'build'/);
    }
  });
});
