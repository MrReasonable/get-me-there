import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATED_AT_PACKAGE_ROOT } from './generated-dirs.mjs';

// WP16a review R37: the scripts' one list of generated directories, kept equal to what .gitignore ignores.
describe('GENERATED_AT_PACKAGE_ROOT', () => {
  it('every entry is a directory .gitignore ignores (at the root, or under a package root)', () => {
    // why: the directory name an ignore line ends with (`/coverage/`, `packages/*/coverage/`, `apps/web/test-results/`)
    const ignored = readFileSync(join(import.meta.dirname, '..', '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('/') && !l.startsWith('#') && !l.startsWith('!'))
      .map((l) => l.replace(/\/$/, '').split('/').pop());
    for (const dir of GENERATED_AT_PACKAGE_ROOT) expect(ignored, dir).toContain(dir);
  });
});
