import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec §6.1: "epoch-day integers and Intl only, never Date-local arithmetic". WP1's source must not
// construct or call Date at all; this test reads the files so a later edit cannot slip one in.
const ROOT = join(import.meta.dirname, '..', 'src');
const DIRS = ['dates', 'space', 'coverage', 'selection'];

describe('WP1 sources never use Date', () => {
  const files = DIRS.flatMap((dir) => readdirSync(join(ROOT, dir)).map((f) => join(ROOT, dir, f)));
  it('found the files', () => expect(files.length).toBeGreaterThanOrEqual(7));
  it.each(files)('%s has no Date', (file) => {
    // why: one left-to-right pass matches string literals and comments together, so a `//` inside a
    // string (a URL) is not taken for a comment start and a quote inside a comment is not taken for a
    // string start; strings are blanked and comments dropped before the `Date` search.
    const code = readFileSync(file, 'utf8').replace(
      /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      (_match, str: string | undefined) => (str === undefined ? '' : '""'),
    );
    expect(code).not.toMatch(/\bDate\b/);
  });
});
