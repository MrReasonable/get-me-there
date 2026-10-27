import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HELPER_PACKAGES, helperProblems, isTestFile, mkdtempIn } from './check-temp-dirs.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));

// why: the first case scans every file git lists, in a child process allowed 60 s; the test allows the same
describe('scripts/check-temp-dirs.mjs', { timeout: 60_000 }, () => {
  it('passes on this repository', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-temp-dirs.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
  it('finds every mkdtemp spelling and names the line', () => {
    const text = [
      "import { mkdtempSync } from 'node:fs';",
      'const d = mkdtempSync(join(tmpdir(), "x-"));',
      'await fs.mkdtemp(p);',
    ];
    expect(mkdtempIn('t.ts', text.join('\n'))).toEqual([
      "t.ts:1: import { mkdtempSync } from 'node:fs';",
      't.ts:2: const d = mkdtempSync(join(tmpdir(), "x-"));',
      't.ts:3: await fs.mkdtemp(p);',
    ]);
    expect(mkdtempIn('t.ts', 'tempDir("x-")')).toEqual([]);
  });
  it('reads test files and support files, not sources or installed packages', () => {
    expect(isTestFile('apps/cli/test/exec/files.test.ts')).toBe(true);
    expect(isTestFile('packages/db/test/helpers/db.ts')).toBe(true);
    expect(isTestFile('apps/web/e2e/smoke.spec.ts')).toBe(true);
    expect(isTestFile('scripts/backup.test.mjs')).toBe(true);
    expect(isTestFile('apps/cli/src/main.ts')).toBe(false);
    expect(isTestFile('scripts/ensure-build-lib.mjs')).toBe(false);
    expect(isTestFile('apps/cli/test/node_modules/x/index.js')).toBe(false);
    expect(isTestFile('apps/api/.stryker-tmp/sandbox-1/test/a.test.ts')).toBe(false);
  });
  it('flags a copy of the helper that differs, and a config that does not list it', () => {
    const real = (f) => readFileSync(join(REPO, f), 'utf8');
    expect(helperProblems(real)).toEqual([]);
    const other = HELPER_PACKAGES[1];
    expect(
      helperProblems((f) => (f === `${other}/test/support/tempdirs.ts` ? `${real(f)}\n// drift` : real(f))),
    ).toEqual([
      `${other}/test/support/tempdirs.ts differs from ${HELPER_PACKAGES[0]}/test/support/tempdirs.ts`,
    ]);
    expect(helperProblems((f) => (f === 'vitest.config.ts' ? '' : real(f)))).toHaveLength(1);
    expect(
      helperProblems((f) =>
        f === `${other}/vitest.config.ts` ? real(f).replace('tempdirs.ts', 'x.ts') : real(f),
      ),
    ).toEqual([`${other}/vitest.config.ts does not list 'test/support/tempdirs.ts' in setupFiles`]);
  });
});
