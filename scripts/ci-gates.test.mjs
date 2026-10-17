import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: Vitest takes `coverage` from the root config only, which sets no thresholds, so a root coverage run enforces none
// of the packages' own (and skips the web TZ suite). CI must call each package's `test` script (review arch I1, round 2).
const CI = readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');

describe('CI enforces every package’s own coverage thresholds', () => {
  it('runs each package’s test script, one at a time, instead of the root coverage run', () => {
    expect(CI).toMatch(/run: pnpm -r --workspace-concurrency=1 test\s*$/m);
    expect(CI).not.toMatch(/pnpm test:coverage/);
  });
  it('the root test:coverage script is the same gated per-package run, never a root coverage run (ts-006)', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts['test:coverage']).toBe('pnpm -r --workspace-concurrency=1 test');
  });
  it('still runs the root scripts project', () => {
    expect(CI).toMatch(/run: pnpm exec vitest run --project scripts\s*$/m);
  });
  it('every workspace package with a vitest config has a test script that runs coverage', () => {
    for (const dir of [
      'packages/core',
      'packages/db',
      'packages/providers',
      'packages/engine',
      'apps/api',
      'apps/web',
    ]) {
      const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.test, dir).toContain('--coverage');
    }
  });
  it('the web test script chains the TZ suite', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../apps/web/package.json'), 'utf8'));
    expect(pkg.scripts.test).toContain('test:tz');
  });
});
