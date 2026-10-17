import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordingsPresent, SKIP_SUFFIX, skipTitle } from './recordings.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'gmt-recpresent-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('recordingsPresent', () => {
  it('reports absent on an empty directory and on a missing one', () => {
    const root = tmp();
    expect(recordingsPresent(root)).toBe(false);
    expect(recordingsPresent(join(root, 'nope'))).toBe(false);
  });

  it('ignores the tracked params-*.json and .raw.json files', () => {
    const root = tmp();
    mkdirSync(join(root, 'searchapi'), { recursive: true });
    writeFileSync(join(root, 'searchapi', 'params-2026-10-15.json'), '{}');
    writeFileSync(join(root, 'searchapi', 'x.raw.json'), '{}');
    expect(recordingsPresent(root)).toBe(false);
  });

  it('reports present once a planted recording exists', () => {
    const root = tmp();
    mkdirSync(join(root, 'searchapi', '_api_v1_search'), { recursive: true });
    writeFileSync(join(root, 'searchapi', '_api_v1_search', '2026-10-20-0123456789ab.json'), '{}');
    expect(recordingsPresent(root)).toBe(true);
  });

  it('suffixes the title only when skipped', () => {
    expect(skipTitle('t', true)).toBe('t');
    expect(skipTitle('t', false)).toBe(`t${SKIP_SUFFIX}`);
  });
});
