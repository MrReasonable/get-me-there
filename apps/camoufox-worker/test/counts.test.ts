import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { counts, EX_TEMPFAIL } from '../src/counts.js';
import { acquireLock } from '../src/lock.js';
import { writePrivateFile } from '../src/privateFile.js';
import { type EntryContext, EX_CONFIG } from '../src/run.js';
import { tmpDir } from './support/tmp.js';

// why: W3 (ca-b1-005): `gmt browser counts` rewrites the counts file only through this entry, under the worker's lock
const clock = fixedClock(asIsoDateTime('2027-10-03T12:00:00.000Z'));
function ctx(args: string[], env: Record<string, string> = {}) {
  const dataDir = tmpDir();
  const out: string[] = [];
  const err: string[] = [];
  const c: EntryContext = {
    env: { CAMOUFOX_WORKER_KEY: 'synthetic-worker-key-0123456789abcdef', HOME: '/h', ...env },
    dataDir,
    args,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { c, out, err, dataDir };
}
const stdin = (text: string) => async () => text;

beforeEach(() => {
  expect.hasAssertions();
});

describe('run.ts counts (W3)', () => {
  it('--check reads the file’s state and writes nothing', async () => {
    const t = ctx(['--check']);
    expect(await counts(t.c, { clock, stdin: stdin('') })).toBe(0);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({ counts: 'ok' });
    writeFileSync(join(t.dataDir, 'pacer.json'), '{}', { mode: 0o600 });
    await counts(t.c, { clock, stdin: stdin('') });
    expect(JSON.parse(t.out[1] ?? '')).toEqual({ counts: 'missing' });
    writeFileSync(join(t.dataDir, 'monthly.json'), '{', { mode: 0o600 });
    await counts(t.c, { clock, stdin: stdin('') });
    expect(JSON.parse(t.out[2] ?? '')).toEqual({ counts: 'unreadable' });
    expect(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8')).toBe('{');
  });
  it('--json writes this window’s figures from stdin, 0600, under the lock, and prints them', async () => {
    const t = ctx(['--json'], { CAMOUFOX_BILLING_DAY: '15' });
    writeFileSync(join(t.dataDir, 'monthly.json'), 'garbled', { mode: 0o600 });
    expect(await counts(t.c, { clock, stdin: stdin('{"pages":40,"scrolls":200}') })).toBe(0);
    const want = {
      windowStart: '2027-09-15T00:00:00.000Z',
      windowEnd: '2027-10-15T00:00:00.000Z',
      pages: 40,
      scrolls: 200,
    };
    expect(JSON.parse(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8'))).toEqual(want);
    expect(statSync(join(t.dataDir, 'monthly.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({ ok: true, ...want });
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
  });
  it.each([
    ['not JSON', 'x'],
    ['a window given', '{"pages":1,"scrolls":1,"windowStart":"2027-10-01T00:00:00.000Z"}'],
    ['a negative count', '{"pages":-1,"scrolls":1}'],
    ['scrolls missing', '{"pages":1}'],
  ])('refuses %s on stdin, writing nothing', async (_w, text) => {
    const t = ctx(['--json']);
    expect(await counts(t.c, { clock, stdin: stdin(text) })).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('the counts on stdin were refused');
    expect(existsSync(join(t.dataDir, 'monthly.json'))).toBe(false);
  });
  it('refuses while another worker holds the lock, writing nothing; refuses bad settings and other arguments', async () => {
    const t = ctx(['--json']);
    acquireLock(t.dataDir, { pid: process.pid });
    expect(await counts(t.c, { clock, stdin: stdin('{"pages":1,"scrolls":1}') })).toBe(EX_TEMPFAIL);
    expect(t.err.join()).toContain('pnpm gmt stop --only worker');
    expect(existsSync(join(t.dataDir, 'monthly.json'))).toBe(false);
    const bad = ctx(['--json'], { CAMOUFOX_WORKER_KEY: 'short' });
    expect(await counts(bad.c, { clock, stdin: stdin('{"pages":1,"scrolls":1}') })).toBe(EX_CONFIG);
    expect(bad.err.join()).toContain('CAMOUFOX_WORKER_KEY');
    const other = ctx([]);
    expect(await counts(other.c, { clock, stdin: stdin('') })).toBe(EX_CONFIG);
    expect(other.err.join()).toContain('usage: run.ts counts');
  });
});

describe('writePrivateFile (ca-b1-015)', () => {
  it('replaces the file at 0600 through a temporary file of its own, leaving none behind', () => {
    const d = tmpDir();
    const f = join(d, 'a.json');
    writeFileSync(f, 'old', { mode: 0o644 });
    writeFileSync(`${f}.tmp`, 'stale', { mode: 0o644 });
    writePrivateFile(f, 'new');
    expect(readFileSync(f, 'utf8')).toBe('new');
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readdirSync(d).sort()).toEqual(['a.json', 'a.json.tmp']);
  });
  it('a failed rename leaves the old file and no temporary file', () => {
    const d = tmpDir();
    const f = join(d, 'dir-in-the-way');
    const { mkdirSync } = process.getBuiltinModule('node:fs');
    mkdirSync(join(f, 'x'), { recursive: true });
    expect(() => writePrivateFile(f, 'new')).toThrow();
    expect(readdirSync(d)).toEqual(['dir-in-the-way']);
  });
});
