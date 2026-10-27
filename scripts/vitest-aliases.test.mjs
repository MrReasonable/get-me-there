import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gmtAliases, gmtAliasesChecked } from '../vitest.aliases.ts';
import { tempDir } from './test-tempdirs.mjs';

// why: ca-b1-023: the cli's and the worker's configs load the table by computed URL and rely on this check alone
const ROOT = fileURLToPath(new URL('../', import.meta.url));

describe('gmtAliasesChecked (the alias table the cli and worker configs share)', () => {
  it('is the alias table, every fixed replacement present', () => {
    expect(gmtAliasesChecked(ROOT)).toEqual(gmtAliases(ROOT));
  });
  it('refuses a directory that is not the workspace root', () => {
    const d = tempDir('gmt-aliases-');
    try {
      expect(() => gmtAliasesChecked(d)).toThrow('is not the workspace root');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
