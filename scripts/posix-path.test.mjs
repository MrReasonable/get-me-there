import { describe, expect, it } from 'vitest';
import { isEnvReader, toPosix } from './posix-path.mjs';

// why: CI run 40130578076 (U13): on Windows the boundary script walked backslash paths and compared them with
// forward-slash rules, so every allowed environment reader read as a violation and the Windows leg never ran a test
describe('scripts/posix-path.mjs', () => {
  it('turns a Windows path into the repository’s forward-slash form, and leaves a POSIX path alone', () => {
    expect(toPosix('apps\\cli\\src\\main.ts')).toBe('apps/cli/src/main.ts');
    expect(toPosix('apps/cli/src/main.ts')).toBe('apps/cli/src/main.ts');
  });
  it.each([
    ['apps\\cli\\src\\main.ts', true],
    ['apps\\api\\src\\bootstrap\\start.ts', true],
    ['apps\\camoufox-worker\\src\\run.ts', true],
    ['scripts\\backup.mjs', true],
    ['apps\\cli\\src\\commands\\setup.ts', false],
    ['scripts\\lib\\helper.mjs', false],
    ['apps/api/src/routes/bootstrap/x.ts', false],
  ])('isEnvReader(%s) is %s, with either separator', (path, allowed) => {
    expect(isEnvReader(path)).toBe(allowed);
  });
});
