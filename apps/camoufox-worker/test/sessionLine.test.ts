import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { acquireLock } from '../src/lock.js';
import { countsFact } from '../src/monthly.js';
import { type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from '../src/run.js';
import {
  EX_TEMPFAIL,
  SESSION_LINE_MAX_BYTES,
  type SessionLine,
  sessionEntry,
  sessionLineSchema,
} from '../src/sessionLine.js';
import { tmpDir } from './support/tmp.js';

// why: WP17 Task 17.8: a recording session (a container, or a throwaway HOME) loads its pages from the operator's own
// address, so its spacing starts from the host's last page, and its pages, scrolls and any cool-down come back to the
// host's data directory before the host's worker starts again
const NOW = asIsoDateTime('2027-10-03T12:00:00.000Z');
const KEY = 'synthetic-worker-key-0123456789abcdef';

function dir(files: Record<string, unknown> = {}): string {
  const d = tmpDir();
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(d, name), typeof body === 'string' ? body : JSON.stringify(body), { mode: 0o600 });
  return d;
}
function ctx(dataDir: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const c: EntryContext = {
    env: { CAMOUFOX_WORKER_KEY: KEY, HOME: '/h', ...env },
    dataDir,
    args,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { c, out, err };
}
const deps = (stdin = '', now = NOW) => ({
  clock: fixedClock(now),
  stdin: async (max: number) => (Buffer.byteLength(stdin) > max ? ('too-long' as const) : stdin),
});
const read = (d: string, name: string): unknown => JSON.parse(readFileSync(join(d, name), 'utf8'));
const OCT = { windowStart: '2027-10-01T00:00:00.000Z', windowEnd: '2027-11-01T00:00:00.000Z' };
const line = (o: Partial<SessionLine> = {}): string =>
  JSON.stringify({
    lastPageAt: '2027-10-03T11:58:00.000Z',
    windowStart: OCT.windowStart,
    pages: 9,
    scrolls: 4,
    cooldown: null,
    ...o,
  });

beforeEach(() => {
  expect.hasAssertions();
});

describe('run.ts session export (Task 17.8)', () => {
  it('prints one JSON line: the last page, this window’s counts and the cool-down in force; writes nothing', async () => {
    const d = dir({
      'pacer.json': { lastPageAt: '2027-10-03T11:00:00.000Z' },
      'monthly.json': { ...OCT, pages: 40, scrolls: 300 },
      'cooldown.json': { until: '2027-10-03T13:00:00.000Z', cause: 'unrecognised' },
    });
    const t = ctx(d, ['export']);
    expect(await sessionEntry(t.c, deps())).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({
      lastPageAt: '2027-10-03T11:00:00.000Z',
      windowStart: OCT.windowStart,
      pages: 40,
      scrolls: 300,
      cooldown: { until: '2027-10-03T13:00:00.000Z', cause: 'unrecognised' },
    });
    expect(sessionLineSchema.safeParse(JSON.parse(t.out[0] ?? '')).success).toBe(true);
    expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 40, scrolls: 300 });
  });
  it('a new data directory exports no last page, zero counts in this window and no cool-down', async () => {
    const d = dir();
    const t = ctx(d, ['export'], { CAMOUFOX_BILLING_DAY: '15' });
    expect(await sessionEntry(t.c, deps())).toBe(0);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({
      lastPageAt: null,
      windowStart: '2027-09-15T00:00:00.000Z',
      pages: 0,
      scrolls: 0,
      cooldown: null,
    });
    expect(existsSync(join(d, 'monthly.json'))).toBe(false);
  });
  it('counts of an ended window export as this window’s zero; an ended cool-down exports as none', async () => {
    const d = dir({
      'pacer.json': { lastPageAt: '2027-09-20T11:00:00.000Z' },
      'monthly.json': {
        windowStart: '2027-09-01T00:00:00.000Z',
        windowEnd: OCT.windowStart,
        pages: 5,
        scrolls: 1,
      },
      'cooldown.json': { until: '2027-10-03T11:00:00.000Z', cause: 'captcha' },
    });
    const t = ctx(d, ['export']);
    expect(await sessionEntry(t.c, deps())).toBe(0);
    expect(JSON.parse(t.out[0] ?? '')).toMatchObject({
      windowStart: OCT.windowStart,
      pages: 0,
      scrolls: 0,
      cooldown: null,
    });
  });
  it('refuses unreadable counts, naming the problem, and prints no line', async () => {
    const d = dir({ 'pacer.json': { lastPageAt: '2027-10-03T11:00:00.000Z' }, 'monthly.json': '{' });
    const t = ctx(d, ['export']);
    expect(await sessionEntry(t.c, deps())).toBe(EX_CONFIG);
    expect(t.out).toEqual([]);
    expect(t.err.join()).toMatch(/monthly counts are unreadable/);
    const m = dir({ 'pacer.json': { lastPageAt: '2027-10-03T11:00:00.000Z' } });
    const u = ctx(m, ['export']);
    expect(await sessionEntry(u.c, deps())).toBe(EX_CONFIG);
    expect(u.err.join()).toMatch(/monthly counts are missing/);
  });
});

describe('run.ts session seed (Task 17.8)', () => {
  it('sets only the last-page time, 0600, under the lock; counts and cool-down are not touched', async () => {
    const d = dir({ 'monthly.json': { ...OCT, pages: 3, scrolls: 2 } });
    const t = ctx(d, ['seed']);
    expect(await sessionEntry(t.c, deps(line({ cooldown: null })))).toBe(0);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:58:00.000Z' });
    expect(statSync(join(d, 'pacer.json')).mode & 0o777).toBe(0o600);
    expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 3, scrolls: 2 });
    expect(existsSync(join(d, 'cooldown.json'))).toBe(false);
    expect(existsSync(join(d, 'worker.lock'))).toBe(false);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({ ok: true, lastPageAt: '2027-10-03T11:58:00.000Z' });
  });
  // why: a pacer file with no counts file beside it is an earlier worker's data, which the counts refuse (fail
  // closed); the 2026-10-26 linux-arm64 session's first page was refused so, before it loaded
  it('in a new directory it also starts this window’s counts at zero, so the pages that follow are counted', async () => {
    const d = dir();
    expect(await sessionEntry(ctx(d, ['seed'], { CAMOUFOX_BILLING_DAY: '15' }).c, deps(line()))).toBe(0);
    expect(read(d, 'monthly.json')).toEqual({
      windowStart: '2027-09-15T00:00:00.000Z',
      windowEnd: '2027-10-15T00:00:00.000Z',
      pages: 0,
      scrolls: 0,
    });
    expect(statSync(join(d, 'monthly.json')).mode & 0o777).toBe(0o600);
    expect(countsFact(d)).toBe('ok');
    const e = dir();
    expect(await sessionEntry(ctx(e, ['seed']).c, deps(line({ lastPageAt: null })))).toBe(0);
    expect(read(e, 'monthly.json')).toEqual({ ...OCT, pages: 0, scrolls: 0 });
  });
  it('refuses where the counts are missing or unreadable beside a pacer file, writing nothing', async () => {
    const d = dir({ 'pacer.json': { lastPageAt: '2027-10-03T11:00:00.000Z' } });
    const t = ctx(d, ['seed']);
    expect(await sessionEntry(t.c, deps(line()))).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/monthly counts are missing/);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:00:00.000Z' });
    expect(existsSync(join(d, 'monthly.json'))).toBe(false);
  });
  it('never moves this directory’s last page earlier; a line with none leaves the record as it is', async () => {
    const d = dir({
      'pacer.json': { lastPageAt: '2027-10-03T11:59:00.000Z' },
      'monthly.json': { ...OCT, pages: 0, scrolls: 0 },
    });
    expect(await sessionEntry(ctx(d, ['seed']).c, deps(line()))).toBe(0);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:59:00.000Z' });
    const e = dir();
    const t = ctx(e, ['seed']);
    expect(await sessionEntry(t.c, deps(line({ lastPageAt: null })))).toBe(0);
    expect(existsSync(join(e, 'pacer.json'))).toBe(false);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({ ok: true, lastPageAt: null });
  });
  it('refuses while the host’s cool-down is active, naming its end, and writes nothing', async () => {
    const d = dir();
    const t = ctx(d, ['seed']);
    const cooldown = { until: asIsoDateTime('2027-10-04T12:00:00.000Z'), cause: 'captcha' as const };
    expect(await sessionEntry(t.c, deps(line({ cooldown })))).toBe(EX_UNAVAILABLE);
    expect(t.err.join()).toContain('cooling down until 2027-10-04T12:00:00.000Z (captcha)');
    expect(existsSync(join(d, 'pacer.json'))).toBe(false);
    // an ended one is no refusal
    const e = dir();
    const ended = { until: NOW, cause: 'captcha' as const };
    expect(await sessionEntry(ctx(e, ['seed']).c, deps(line({ cooldown: ended })))).toBe(0);
  });
  it('refuses while another process holds this directory’s lock', async () => {
    const d = dir();
    acquireLock(d, { pid: process.pid });
    const t = ctx(d, ['seed']);
    expect(await sessionEntry(t.c, deps(line()))).toBe(EX_TEMPFAIL);
    expect(t.err.join()).toContain('holds the lock');
    expect(existsSync(join(d, 'pacer.json'))).toBe(false);
  });
});

describe('run.ts session merge (Task 17.8)', () => {
  it('adds the counts when the windows match and keeps the later last-page time, under the lock', async () => {
    const d = dir({
      'pacer.json': { lastPageAt: '2027-10-03T10:00:00.000Z' },
      'monthly.json': { ...OCT, pages: 40, scrolls: 300 },
    });
    const t = ctx(d, ['merge']);
    expect(await sessionEntry(t.c, deps(line()))).toBe(0);
    expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 49, scrolls: 304 });
    expect(statSync(join(d, 'monthly.json')).mode & 0o777).toBe(0o600);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:58:00.000Z' });
    expect(existsSync(join(d, 'cooldown.json'))).toBe(false);
    expect(existsSync(join(d, 'worker.lock'))).toBe(false);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({
      ok: true,
      countsAdded: true,
      lastPageAt: '2027-10-03T11:58:00.000Z',
      ...OCT,
      pages: 49,
      scrolls: 304,
      cooldown: null,
    });
  });
  it('keeps the host’s later last page, and a session line with none leaves it', async () => {
    const d = dir({
      'pacer.json': { lastPageAt: '2027-10-03T11:59:30.000Z' },
      'monthly.json': { ...OCT, pages: 1, scrolls: 0 },
    });
    expect(await sessionEntry(ctx(d, ['merge']).c, deps(line()))).toBe(0);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:59:30.000Z' });
    expect(
      await sessionEntry(ctx(d, ['merge']).c, deps(line({ lastPageAt: null, pages: 0, scrolls: 0 }))),
    ).toBe(0);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:59:30.000Z' });
  });
  it('a new host directory starts this window at the session’s counts', async () => {
    const d = dir();
    expect(await sessionEntry(ctx(d, ['merge']).c, deps(line()))).toBe(0);
    expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 9, scrolls: 4 });
  });
  it('windows that differ add no counts and say so; the last page and the cool-down still come back', async () => {
    const d = dir({
      'pacer.json': { lastPageAt: '2027-10-03T10:00:00.000Z' },
      'monthly.json': { ...OCT, pages: 40, scrolls: 300 },
    });
    const t = ctx(d, ['merge']);
    const cooldown = { until: asIsoDateTime('2027-10-03T13:00:00.000Z'), cause: 'unrecognised' as const };
    expect(
      await sessionEntry(
        t.c,
        deps(line({ windowStart: asIsoDateTime('2027-09-15T00:00:00.000Z'), cooldown })),
      ),
    ).toBe(0);
    expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 40, scrolls: 300 });
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:58:00.000Z' });
    expect(read(d, 'cooldown.json')).toEqual(cooldown);
    expect(t.err.join()).toContain(
      'the windows differ (this directory 2027-10-01T00:00:00.000Z, the session 2027-09-15T00:00:00.000Z)',
    );
    expect(JSON.parse(t.out[0] ?? '')).toMatchObject({ ok: true, countsAdded: false, pages: 40 });
  });
  // why: CodeRabbit (PR #21): a new host directory whose window differs from the session's still gets its counts
  // file beside the carried last-page time, or every page would refuse as counts-missing
  it('a new host directory whose window differs gets this window’s zero counts beside the carried time', async () => {
    const d = dir();
    const t = ctx(d, ['merge'], { CAMOUFOX_BILLING_DAY: '15' });
    expect(await sessionEntry(t.c, deps(line()))).toBe(0);
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T11:58:00.000Z' });
    expect(read(d, 'monthly.json')).toEqual({
      windowStart: '2027-09-15T00:00:00.000Z',
      windowEnd: '2027-10-15T00:00:00.000Z',
      pages: 0,
      scrolls: 0,
    });
    expect(countsFact(d)).toBe('ok');
    expect(t.err.join()).toContain('the windows differ');
  });
  it('carries the session’s active cool-down; the longer one stands', async () => {
    const d = dir({
      'monthly.json': { ...OCT, pages: 1, scrolls: 0 },
      'cooldown.json': { until: '2027-10-03T13:00:00.000Z', cause: 'unrecognised' },
    });
    const longer = { until: asIsoDateTime('2027-10-05T12:00:00.000Z'), cause: 'captcha' as const };
    const t = ctx(d, ['merge']);
    expect(await sessionEntry(t.c, deps(line({ cooldown: longer })))).toBe(0);
    expect(read(d, 'cooldown.json')).toEqual(longer);
    expect(JSON.parse(t.out[0] ?? '')).toMatchObject({ cooldown: longer });
    const shorter = { until: asIsoDateTime('2027-10-03T12:30:00.000Z'), cause: 'unrecognised' as const };
    expect(await sessionEntry(ctx(d, ['merge']).c, deps(line({ cooldown: shorter })))).toBe(0);
    expect(read(d, 'cooldown.json')).toEqual(longer);
  });
  it('refuses while the host worker holds the lock, writing nothing', async () => {
    const d = dir({ 'monthly.json': { ...OCT, pages: 1, scrolls: 0 } });
    acquireLock(d, { pid: process.pid });
    const t = ctx(d, ['merge']);
    expect(await sessionEntry(t.c, deps(line()))).toBe(EX_TEMPFAIL);
    expect(t.err.join()).toContain('pnpm gmt stop --only worker');
    expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 1, scrolls: 0 });
    expect(existsSync(join(d, 'pacer.json'))).toBe(false);
  });
  // why: as root the directory's mode does not stop the lock's write, so there is no error to see
  it.skipIf(process.getuid?.() === 0)(
    'an error taking the lock other than a held lock is thrown as it is, never reported as a refusal',
    async () => {
      const d = dir({ 'monthly.json': { ...OCT, pages: 1, scrolls: 0 } });
      chmodSync(d, 0o500);
      try {
        await expect(sessionEntry(ctx(d, ['merge']).c, deps(line()))).rejects.toThrow(/EACCES|permission/i);
      } finally {
        chmodSync(d, 0o700);
      }
      expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 1, scrolls: 0 });
    },
  );
  it('refuses unreadable host counts as they stand', async () => {
    const d = dir({ 'pacer.json': { lastPageAt: '2027-10-03T10:00:00.000Z' }, 'monthly.json': '{' });
    const t = ctx(d, ['merge']);
    expect(await sessionEntry(t.c, deps(line()))).toBe(EX_CONFIG);
    expect(readFileSync(join(d, 'monthly.json'), 'utf8')).toBe('{');
    expect(read(d, 'pacer.json')).toEqual({ lastPageAt: '2027-10-03T10:00:00.000Z' });
    expect(existsSync(join(d, 'worker.lock'))).toBe(false);
  });
});

describe('the session line on stdin (Task 17.8)', () => {
  it.each([
    ['not JSON', 'x'],
    ['an extra field', line().replace('{', '{"extra":1,')],
    ['a negative count', line({ pages: -1 })],
    ['a fractional count', line({ scrolls: 1.5 })],
    ['a time that is not an instant', line().replace('2027-10-03T11:58:00.000Z', '2027-10-03')],
    [
      'a cool-down of an unknown cause',
      line().replace('"cooldown":null', '"cooldown":{"until":"2027-10-04T00:00:00.000Z","cause":"x"}'),
    ],
    [
      'the counts missing',
      JSON.stringify({ lastPageAt: null, windowStart: OCT.windowStart, cooldown: null }),
    ],
    ['two lines', `${line()}\n${line()}`],
    ['nothing', ''],
  ])('seed and merge refuse %s, writing nothing', async (_w, text) => {
    for (const sub of ['seed', 'merge']) {
      const d = dir({ 'monthly.json': { ...OCT, pages: 1, scrolls: 0 } });
      const t = ctx(d, [sub]);
      expect(await sessionEntry(t.c, deps(text))).toBe(EX_CONFIG);
      expect(t.err.join()).toContain('the session line on stdin was refused');
      expect(read(d, 'monthly.json')).toEqual({ ...OCT, pages: 1, scrolls: 0 });
      expect(existsSync(join(d, 'pacer.json'))).toBe(false);
    }
  });
  it('refuses a line over its size bound', async () => {
    const t = ctx(dir(), ['merge']);
    expect(await sessionEntry(t.c, deps(' '.repeat(SESSION_LINE_MAX_BYTES + 1)))).toBe(EX_CONFIG);
    expect(t.err.join()).toContain(`more than ${SESSION_LINE_MAX_BYTES} bytes`);
  });
  it('a trailing newline is one line', async () => {
    expect(await sessionEntry(ctx(dir(), ['merge']).c, deps(`${line()}\n`))).toBe(0);
  });
  it('export’s line is what seed and merge read (round trip)', async () => {
    const instant = fc
      .integer({ min: Date.parse('2027-01-01T00:00:00.000Z'), max: Date.parse('2027-10-03T11:59:59.000Z') })
      .map((ms) => new Date(ms).toISOString());
    await fc.assert(
      fc.asyncProperty(instant, fc.nat(1500), fc.nat(9000), async (last, pages, scrolls) => {
        const host = dir({ 'pacer.json': { lastPageAt: last }, 'monthly.json': { ...OCT, pages, scrolls } });
        const ex = ctx(host, ['export']);
        expect(await sessionEntry(ex.c, deps())).toBe(0);
        const back = dir();
        expect(await sessionEntry(ctx(back, ['merge']).c, deps(ex.out[0] ?? ''))).toBe(0);
        expect(read(back, 'monthly.json')).toEqual({ ...OCT, pages, scrolls });
        expect(read(back, 'pacer.json')).toEqual({ lastPageAt: last });
      }),
      { numRuns: 25 },
    );
  });
  it('refuses another subcommand and bad settings', async () => {
    const t = ctx(dir(), ['other']);
    expect(await sessionEntry(t.c, deps())).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('usage: run.ts session export | seed | merge');
    const none = ctx(dir(), []);
    expect(await sessionEntry(none.c, deps())).toBe(EX_CONFIG);
    // why: the subcommand is the arguments as written, never run together
    expect(await sessionEntry(ctx(dir(), ['se', 'ed']).c, deps(line()))).toBe(EX_CONFIG);
    const bad = ctx(dir(), ['export'], { CAMOUFOX_WORKER_KEY: 'short' });
    expect(await sessionEntry(bad.c, deps())).toBe(EX_CONFIG);
    expect(bad.err.join()).toContain('CAMOUFOX_WORKER_KEY');
  });
});
