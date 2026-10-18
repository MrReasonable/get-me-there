// The operator's wording ruling (WP14 fix rounds 1 and 2): no tracked file but the lockfile uses the ruled words, and
// none uses the bare word for an automated client, alone or as the head of a name (camel case or hyphenated). Each pattern brackets one letter, so this file never matches itself.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..');
const RULED =
  /anti-detectio[n]|bo[t] chec[k]|bo[t] detec[t]|bo[t] protectio[n]|robot[s]\.txt|terms of servic[e]|recognised as automatio[n]|evad[e]|stealt[h]/i;
// why: case-sensitive after the word, so a camel-case or hyphenated head (`…Hours`, `…-length`) is caught and "both"
// is not
const BARE = /\b[Bb][Oo][t](?:s?\b|[A-Z_-])/;
const SKIP = new Set(['pnpm-lock.yaml']);
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|db|sqlite)$/i;

describe('the wording ruling holds across the tree', { timeout: 60_000 }, () => {
  it('no tracked file uses a ruled word', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((f) => f !== '' && !SKIP.has(f) && !BINARY.test(f));
    const hits = [];
    for (const f of files) {
      let text;
      try {
        text = readFileSync(join(REPO, f), 'utf8');
      } catch {
        continue;
      }
      text.split('\n').forEach((line, i) => {
        if (RULED.test(line) || BARE.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
