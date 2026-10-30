import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The departure board's stylesheet, read by the tests that check its colours, so a test can never hold a stale copy.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/world.css'), 'utf8');

/** A colour token's value in world.css (`--amber` → "#ffb22e"). */
export function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (m?.[1] === undefined) throw new Error(`no --${name} in world.css`);
  return m[1];
}

/** The colour a class's rule sets on `property` through a token (`.tag-warn`, `color` → the value of `--amber`). */
export function classToken(selector: string, property: 'color' | 'background'): string {
  const block = new RegExp(`\\n\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  const name =
    block === undefined ? null : new RegExp(`${property}:\\s*var\\(--([\\w-]+)\\)`).exec(block)?.[1];
  if (name === null || name === undefined) throw new Error(`no ${property} token in ${selector}`);
  return token(name);
}
