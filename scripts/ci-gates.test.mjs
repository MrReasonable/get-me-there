import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: vitest's per-file coverage floors and WP10's timezone suite only run under the web package's own `test` script;
// the root run overwrites a project's coverage settings. CI must call that script or the floors and the Los Angeles
// and Tokyo runs are never enforced (review arch I1).
const CI = readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');

describe('CI enforces the web package gates', () => {
  it('runs the web package test script (coverage floors, then the TZ suite)', () => {
    expect(CI).toMatch(/run: pnpm --filter @gmt\/web test\s*$/m);
  });
  it('the script it calls chains the TZ suite', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../apps/web/package.json'), 'utf8'));
    expect(pkg.scripts.test).toContain('test:tz');
  });
});
