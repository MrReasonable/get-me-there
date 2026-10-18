// The Price graph exploration's pure parts: which region appeared, the query stripping and the write's last check.
// Synthetic values only.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appeared, type RegionRef, stripSnapshotQueries } from '../src/graph.js';
import { writeGraphExplore } from '../src/recordWrite.js';
import { tmpDir } from './support/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

const r = (role: RegionRef['role'], name: string, index = 0): RegionRef => ({ role, index, name });

describe('appeared', () => {
  it('is the first region beyond what was there before, counting repeats', () => {
    expect(appeared([], [r('dialog', 'Price graph')])).toEqual(r('dialog', 'Price graph'));
    expect(appeared([r('region', 'A')], [r('region', 'A')])).toBeNull();
    expect(appeared([r('region', 'A')], [r('region', 'A'), r('region', 'A', 1)])).toEqual(
      r('region', 'A', 1),
    );
    expect(appeared([r('region', 'A')], [r('dialog', 'A')])).toEqual(r('dialog', 'A'));
    expect(appeared([r('region', 'A'), r('region', 'B', 1)], [r('region', 'B')])).toBeNull();
  });
});

describe('stripSnapshotQueries', () => {
  it('drops the query and fragment of every /url: line and every absolute URL, and nothing else', () => {
    const before = [
      '- dialog "Price graph":',
      '  - link "Learn more":',
      '    - /url: /travel/flights/help?tfs=abc&hl=en#top',
      '    - /url: https://www.google.com/x?y=1',
      '  - text: see https://www.google.com/travel/flights?q=z and http://example.test/a#b too',
      '  - button "Why? Prices vary"',
    ].join('\n');
    expect(stripSnapshotQueries(before)).toBe(
      [
        '- dialog "Price graph":',
        '  - link "Learn more":',
        '    - /url: /travel/flights/help',
        '    - /url: https://www.google.com/x',
        '  - text: see https://www.google.com/travel/flights and http://example.test/a too',
        '  - button "Why? Prices vary"',
      ].join('\n'),
    );
  });
});

describe('writeGraphExplore', () => {
  it('refuses a URL that still carries a query, and writes numbered files otherwise', () => {
    const root = tmpDir();
    expect(() => writeGraphExplore(root, '2026-10-18', { a: 'https://www.google.com/x?q=1' }, [])).toThrow(
      /query string; nothing written/,
    );
    expect(writeGraphExplore(root, '2026-10-18', { a: 1 }, [])).toBe(
      join(root, 'graph-explore/2026-10-18/1.json'),
    );
    expect(writeGraphExplore(root, '2026-10-18', { a: 2 }, [])).toBe(
      join(root, 'graph-explore/2026-10-18/2.json'),
    );
    expect(readdirSync(join(root, 'graph-explore/2026-10-18')).sort()).toEqual(['1.json', '2.json']);
  });
});
