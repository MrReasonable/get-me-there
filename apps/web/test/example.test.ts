// Spec §1, §11 "import example" (plan "Web", decision 36): the Definitions form's example is docs/examples/
// london-new-york.json, imported rather than copied, so the docs and the button can never offer different routes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DEFINITION } from '../src/example.js';

// why: plain paths, because this project runs under jsdom, whose URL class node:fs does not accept
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

describe('EXAMPLE_DEFINITION (WP9) and the docs JSON (WP12)', () => {
  it('equals docs/examples/london-new-york.json, the JSON docs/setup.md shows', () => {
    expect(EXAMPLE_DEFINITION).toEqual(JSON.parse(read('docs/examples/london-new-york.json')));
  });

  it('imports the docs JSON rather than copying it', () => {
    expect(read('apps/web/src/example.ts')).toContain("from '../../../docs/examples/london-new-york.json'");
  });
});
