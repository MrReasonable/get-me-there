// The build's version for the Status report (brief WP18 §5): a short SHA from dist/version.json, else "unknown".
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readVersion } from '../../src/bootstrap/version.js';
import { tempDir } from '../helpers/tmp.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/write-version.mjs', import.meta.url));

describe('readVersion', () => {
  const file = (text: string) => {
    const p = join(tempDir('gmt-version-'), 'version.json');
    writeFileSync(p, text);
    return p;
  };
  it('reads a short SHA', () => {
    expect(readVersion(file('{"version":"abc1234"}'))).toBe('abc1234');
  });
  it('a missing, unreadable, malformed or unexpected file is "unknown", whatever it says', () => {
    expect(readVersion(join(tempDir('gmt-version-'), 'none.json'))).toBe('unknown');
    expect(readVersion(file('not json'))).toBe('unknown');
    expect(readVersion(file('{"version":"v1; rm -rf ~"}'))).toBe('unknown');
    expect(readVersion(file('{"version":"abc1234","extra":1}'))).toBe('unknown');
    expect(readVersion(tempDir('gmt-version-'))).toBe('unknown');
  });
  it('the source tree has no version file, so a tsx run reads "unknown"', () => {
    expect(readVersion()).toBe('unknown');
  });
});

describe('scripts/write-version.mjs', () => {
  it('writes the git short SHA to dist/version.json, which readVersion reads', () => {
    const out = join(tempDir('gmt-version-'), 'out', 'version.json');
    const r = spawnSync(process.execPath, [SCRIPT, out], { encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(JSON.parse(text)).toEqual({ version: expect.stringMatching(/^[0-9a-f]{7,40}$/) });
    expect(readVersion(out)).toMatch(/^[0-9a-f]{7,40}$/);
  });
});
